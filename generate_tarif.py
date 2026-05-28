#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
generate_tarif.py — Génère tarif.json à partir du fichier Excel maître VINOM.

Usage :
    python scripts/generate_tarif.py \
        --excel TarifVinom_Master.xlsx \
        --vinistoria Articles.csv \
        --output tarif.json

Le script lit la feuille "tarif" du fichier maître, fait le matching optionnel
avec un export Vinistoria (pour récupérer code article + stock), déduit les
couleurs / labels / formats, et produit le tarif.json consommé par la page web.

Conçu pour tourner en CI (GitHub Actions) sans supervision :
- codes de sortie explicites (0 = OK, != 0 = échec)
- logs lisibles
- garde-fous : si le résultat est manifestement cassé (0 référence,
  chute brutale du nombre de lignes), on échoue plutôt que de publier
  un catalogue vide.
"""

import argparse
import csv
import json
import re
import sys
import unicodedata
from datetime import date
from difflib import SequenceMatcher

import openpyxl


# ===================================================================
# Constantes métier (validées avec Alex)
# ===================================================================

REGION_ORDER = [
    "Île-de-France", "Jura", "Alsace", "Bordeaux", "Beaujolais",
    "Bourgogne", "Rhône", "Loire", "Provence-Corse", "Occitanie",
    "Reste du Monde", "Bulles", "Spiritueux",
]

# Noms de régions en MAJUSCULES tels qu'ils apparaissent dans la feuille
REGIONS_MAJ_NORMALIZED = {
    "ILE DE FRANCE": "Île-de-France",
    "ÎLE DE FRANCE": "Île-de-France",
    "ILE-DE-FRANCE": "Île-de-France",
    "JURA": "Jura",
    "ALSACE": "Alsace",
    "BORDEAUX": "Bordeaux",
    "BEAUJOLAIS": "Beaujolais",
    "BOURGOGNE": "Bourgogne",
    "RHÔNE": "Rhône",
    "RHONE": "Rhône",
    "LOIRE": "Loire",
    "PROVENCE-CORSE": "Provence-Corse",
    "PROVENCE - CORSE": "Provence-Corse",
    "OCCITANIE": "Occitanie",
    "RESTE DU MONDE": "Reste du Monde",
    "BULLES": "Bulles",
    "SPIRITUEUX": "Spiritueux",
}

# Mapping régions Vinistoria (ARTUNDERFAMILY) -> régions catalogue
REGION_MAP_VINI = {
    "BOURGOGN": "Bourgogne", "BORDEAUX": "Bordeaux", "OCCITANI": "Occitanie",
    "RHONE": "Rhône", "CHAMP": "Bulles", "MONDE": "Reste du Monde",
    "LOIRE": "Loire", "PROVENCE": "Provence-Corse", "BEAUJOLA": "Beaujolais",
    "ALSACE": "Alsace", "IDF": "Île-de-France", "JURA": "Jura",
}

# Codes couleur Vinistoria / feuille GDD -> norme catalogue
COULEUR_MAP = {
    "BLC": "blanc", "RGE": "rouge", "ROS": "rose",
    "PET": "bulles", "PTR": "rose", "SPI": "spiritueux",
}

RED_APPELLATIONS = [
    "bandol", "cahors", "fronton", "corbières-boutenac", "gigondas",
    "châteauneuf-du-pape", "beaune", "pommard", "morgon", "fleurie",
    "brouilly", "chiroubles", "moulin à vent", "moulin a vent", "saint amour",
    "gevrey-chambertin", "gevrey chambertin", "vosne romanée", "chambolle-musigny",
    "nuits saint", "irancy", "chinon", "bourgueil", "saint-nicolas-de-bourgueil",
    "st-nicolas-de-bourgueil", "saint-emilion", "saint emilion", "pomerol",
    "pauillac", "saint-julien", "saint julien", "margaux", "medoc", "médoc",
    "saint-estèphe", "saint estèphe", "fronsac", "lalande de pomerol",
    "montagne saint-emilion", "puisseguin",
]
WHITE_APPELLATIONS = [
    "chablis", "pouilly fuissé", "pouilly fumé", "pouilly vinzelles",
    "sancerre blanc", "meursault", "corton charlemagne", "chassagne montrachet",
    "puligny montrachet", "montagny", "rully blanc", "givry blanc", "viré clessé",
    "vire clessé", "saint véran", "saint veran", "condrieu", "saint-péray",
    "saint peray", "menetou salon blanc", "pouilly sur loire", "quincy", "vouvray",
    "montlouis", "mâcon blanc", "macon blanc", "bourgogne aligoté",
    "côtes de gascogne", "cotes de gascogne", "sauternes", "monbazillac",
    "entre deux mers",
]
RED_KEYWORDS = [
    "pinot noir", "merlot", "cabernet", "gamay", "syrah", "malbec",
    "tempranillo", "poulsard", "trousseau", "grenache", "sangiovese", "nebbiolo",
    "corvina", "rouge", " noir", "primitivo", "cinsault", "carignan", "négrette",
    "negrette", "shiraz", "tannat", "pinotage", "nero d", "nero ", "mourvedre",
    "mourvèdre", "verdot", "cot ", "gamay noir",
]
WHITE_KEYWORDS = [
    "chardonnay", "sauvignon", "chenin", "viognier", "riesling", "gewurtz",
    "aligoté", "savagnin", "sylvaner", "pinot grigio", "pinot gris", "pinot blanc",
    "muscat", "gros manseng", "petit manseng", "colombard", "roussanne", "marsanne",
    "clairette", "vermentino", "rolle", "verdejo", "mauzac", "blanc de blancs",
    "moelleux", "liquoreux",
]
ROSE_KEYWORDS = ["rosé", " rose ", " gris ", "rosato"]

# Garde-fou : on refuse de publier si le nombre de références chute trop.
# (Détecte un Excel cassé / une mauvaise feuille.)
MIN_REFERENCES = 200


# ===================================================================
# Utilitaires
# ===================================================================

def log(msg):
    print(f"[generate_tarif] {msg}", flush=True)


def fail(msg, code=1):
    print(f"[generate_tarif] ERREUR : {msg}", file=sys.stderr, flush=True)
    sys.exit(code)


def normalize(s):
    if not s:
        return ""
    s = str(s).lower()
    s = unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    stop = {
        "aop", "aoc", "igp", "le", "la", "les", "du", "de", "des", "d", "l",
        "cuvee", "domaine", "chateau", "cru", "maison", "vin", "vins", "sas",
        "earl", "gaec", "1er", "grand", "sur", "en", "aux",
    }
    words = [w for w in s.split() if w not in stop and len(w) > 1]
    return " ".join(words)


def normalize_key(s):
    if not s:
        return ""
    s = str(s).lower().strip()
    return re.sub(r"\s+", " ", s)


def sim(a, b):
    if not a or not b:
        return 0
    return SequenceMatcher(None, normalize(a), normalize(b)).ratio()


# ===================================================================
# 1. Lecture de la feuille "tarif"
# ===================================================================

def parse_tarif_sheet(path):
    """Lit la feuille 'tarif' et renvoie la liste des références."""
    try:
        wb = openpyxl.load_workbook(path, data_only=True)
    except Exception as e:
        fail(f"impossible d'ouvrir le fichier Excel : {e}")

    if "tarif" not in wb.sheetnames:
        fail(f"feuille 'tarif' absente. Feuilles trouvées : {wb.sheetnames}")

    ws = wb["tarif"]

    # Localiser la plage : de la première région à la ligne CGV
    start_row = None
    end_row = ws.max_row
    for r in range(1, ws.max_row + 1):
        c1 = ws.cell(row=r, column=1).value
        if c1 and str(c1).strip().upper() in REGIONS_MAJ_NORMALIZED:
            if start_row is None:
                start_row = r
        if c1 and "CONDITIONS GENERALES" in str(c1).upper():
            end_row = r
            break

    if start_row is None:
        fail("aucune région reconnue dans la feuille 'tarif'.")

    log(f"Plage de données : ligne {start_row} → {end_row}")

    current_region = None
    current_subregion = None
    refs = []

    for r in range(start_row, end_row):
        row = [ws.cell(row=r, column=c).value for c in range(1, 8)]
        col1, col2, col3, col4, col5, col6, col7 = row

        if not any(v for v in row):
            continue
        if col2 == "Cuvée":  # ligne d'en-tête de tableau
            continue

        # Ligne de section (région ou sous-région)
        if col1 and not any([col2, col3, col4, col5, col6, col7]):
            c1u = str(col1).strip().upper()
            if c1u in REGIONS_MAJ_NORMALIZED:
                current_region = REGIONS_MAJ_NORMALIZED[c1u]
                current_subregion = None
            else:
                current_subregion = str(col1).strip()
            continue

        # Ligne de référence : doit avoir cuvée + prix numérique
        if not col2 or col7 is None:
            continue
        try:
            prix = float(col7)
        except (TypeError, ValueError):
            continue
        if prix <= 0:
            continue

        is_new = (col1 == "N")

        label = col5
        contenance_special = None
        if label and str(label).strip() in ("70cl", "300cl", "37.5cl", "150cl", "50cl"):
            contenance_special = str(label).strip()
            label = None

        refs.append({
            "region": current_region,
            "sous_region": current_subregion,
            "nouveau": is_new,
            "cuvee": str(col2).strip() if col2 else "",
            "domaine": str(col3).strip() if col3 else "",
            "appellation": str(col4).strip() if col4 else "",
            "label": str(label).strip() if label else "",
            "millesime": str(col6).strip() if col6 is not None else "",
            "prix": prix,
            "contenance_special": contenance_special,
        })

    log(f"{len(refs)} références extraites de la feuille 'tarif'.")
    return refs, wb


# ===================================================================
# 2. Index couleurs depuis la feuille "pour GDD1 & 2" (si présente)
# ===================================================================

def build_gdd_indexes(wb):
    """La feuille GDD a une colonne Couleur explicite et un marqueur 'Pépites'.
    On les utilise comme source de vérité quand la feuille existe.
    Renvoie (couleur_index, pepites_list)."""
    couleur_index = {}
    pepites = []
    sheet_name = None
    for name in wb.sheetnames:
        if "gdd" in name.lower():
            sheet_name = name
            break
    if not sheet_name:
        log("Feuille GDD absente : détection couleur par heuristique, pas de Pépites.")
        return couleur_index, pepites

    ws = wb[sheet_name]
    for r in range(2, ws.max_row + 1):
        desig = ws.cell(row=r, column=1).value
        desig2 = ws.cell(row=r, column=2).value
        mill = ws.cell(row=r, column=5).value
        coul = ws.cell(row=r, column=7).value
        carte = ws.cell(row=r, column=8).value
        if not desig:
            continue
        key = (normalize_key(desig), normalize_key(desig2), normalize_key(str(mill or "")))
        if coul and str(coul).strip() in COULEUR_MAP:
            couleur_index[key] = str(coul).strip()
        if carte and str(carte).strip() == "Pépites":
            pepites.append({
                "cuvee": str(desig or "").strip(),
                "domaine": str(desig2 or "").strip(),
            })
    log(f"Index couleurs GDD : {len(couleur_index)} entrées ; Pépites : {len(pepites)}.")
    return couleur_index, pepites


def is_pepite(ref, pepites):
    for p in pepites:
        sc = sim(ref.get("cuvee"), p["cuvee"])
        sd = sim(ref.get("domaine"), p["domaine"])
        if sc > 0.7 and sd > 0.5:
            return True
        if sc > 0.85:
            return True
    return False


def detect_couleur(ref, couleur_index):
    region = ref.get("region") or ""
    if region == "Bulles":
        return "bulles"
    if region == "Spiritueux":
        return "spiritueux"

    key = (normalize_key(ref.get("cuvee")), normalize_key(ref.get("domaine")),
           normalize_key(str(ref.get("millesime") or "")))
    if key in couleur_index:
        return COULEUR_MAP.get(couleur_index[key], "rouge")
    for (c, d, m), v in couleur_index.items():
        if c == key[0] and d == key[1]:
            return COULEUR_MAP.get(v, "rouge")
    for (c, d, m), v in couleur_index.items():
        if c == key[0] and len(key[0]) > 5:
            return COULEUR_MAP.get(v, "rouge")

    sub = (ref.get("sous_region") or "").lower()
    if sub in ("rosés", "rosé"):
        return "rose"
    if sub == "rouges" or "rouges -" in sub:
        return "rouge"
    if sub == "blancs":
        return "blanc"

    app = (ref.get("appellation") or "").lower()
    for kw in RED_APPELLATIONS:
        if kw in app:
            return "rouge"
    for kw in WHITE_APPELLATIONS:
        if kw in app:
            return "blanc"

    cuvee = " " + (ref.get("cuvee") or "").lower() + " "
    for kw in ROSE_KEYWORDS:
        if kw in cuvee:
            return "rose"
    for kw in WHITE_KEYWORDS:
        if kw in cuvee:
            return "blanc"
    for kw in RED_KEYWORDS:
        if kw in cuvee:
            return "rouge"

    if "provence" in app:
        return "rose"
    return "rouge"


# ===================================================================
# 3. Matching Vinistoria (code article + stock) — optionnel
# ===================================================================

def load_vinistoria(path):
    if not path:
        return []
    try:
        with open(path, "r", encoding="cp1252") as f:
            rows = list(csv.reader(f, delimiter=";"))
    except Exception as e:
        log(f"Vinistoria illisible ({e}) : matching ignoré.")
        return []

    articles = []
    for r in rows[1:]:
        if len(r) < 71 or r[7] not in ("VIN", "PET", "SPI"):
            continue
        cuvee = (r[2] or "").strip()
        if not cuvee:
            continue
        region_norm = REGION_MAP_VINI.get(r[55])
        if r[7] == "PET":
            region_norm = "Bulles"
        elif r[7] == "SPI":
            region_norm = "Spiritueux"
        try:
            stock = float(r[70]) if r[70] else 0
        except (TypeError, ValueError):
            stock = 0
        articles.append({
            "code": r[0], "cuvee": cuvee, "domaine": (r[3] or "").strip(),
            "appellation": (r[4] or "").strip(), "millesime": (r[5] or "").strip(),
            "region": region_norm, "stock": stock,
        })
    log(f"Vinistoria : {len(articles)} articles chargés.")
    return articles


def match_vinistoria(ref, vinis):
    if not vinis:
        return ("", None)
    same_region = [v for v in vinis if v["region"] == ref["region"]]
    pool = same_region if same_region else vinis
    best_score, best = 0, None
    for v in pool:
        score = (0.5 * sim(ref["cuvee"], v["cuvee"])
                 + 0.35 * sim(ref["domaine"], v["domaine"])
                 + 0.15 * sim(ref["appellation"], v["appellation"]))
        if ref["millesime"] and v["millesime"] and str(ref["millesime"]).strip() == str(v["millesime"]).strip():
            score += 0.08
        if score > best_score:
            best_score, best = score, v
    if best and best_score >= 0.55:
        return (best["code"], best["stock"])
    return ("", None)


# ===================================================================
# 4. Labels / formats
# ===================================================================

def get_label_tags(label):
    if not label:
        return []
    tags, l = [], label.strip().lower()
    if "bio" in l:
        tags.append("biodynamie" if ("demeter" in l or "biodynam" in l) else "bio")
    if ("demeter" in l or "biodynamie" in l) and "biodynamie" not in tags:
        tags.append("biodynamie")
    if "no so2" in l or "nature" in l or "sans sulfites" in l:
        tags.append("sans_so2")
    if "hve" in l:
        tags.append("hve")
    if "vegan" in l:
        tags.append("vegan")
    if "régénérative" in l:
        tags.append("regen")
    return tags


def get_format(ref):
    cuvee = (ref.get("cuvee") or "").upper()
    cs = (ref.get("contenance_special") or "").upper()
    if "BIB" in cuvee or "BIB" in cs:
        return "bib", ("BIB 10L" if "10L" in cuvee else "BIB 5L")
    if "MAGNUM" in cuvee or "150CL" in cuvee or "150CL" in cs:
        return "magnum", "150cl"
    if "JERO" in cuvee or "300CL" in cuvee or "300CL" in cs:
        return "jeroboam", "300cl"
    if "37,5" in cuvee or "37.5" in cuvee or "37,5" in cs:
        return "demi", "37,5cl"
    return "standard", "75cl"


# ===================================================================
# 5. Assemblage du tarif.json
# ===================================================================

def build_json(refs, couleur_index, pepites, vinis, edition_label, edito):
    items = []
    matched = 0
    for ref in refs:
        code, stock = match_vinistoria(ref, vinis)
        if code:
            matched += 1
        fmt, fmt_label = get_format(ref)
        items.append({
            "id": code or f"X{len(items):04d}",
            "cuvee": ref.get("cuvee", ""),
            "domaine": ref.get("domaine", "") or "",
            "appellation": ref.get("appellation", "") or "",
            "millesime": str(ref.get("millesime", "") or ""),
            "label_display": ref.get("label", "") or "",
            "label_tags": get_label_tags(ref.get("label")),
            "prix": ref.get("prix"),
            "region": ref.get("region", ""),
            "sous_region": ref.get("sous_region") or "",
            "couleur": detect_couleur(ref, couleur_index),
            "format": fmt,
            "format_label": fmt_label,
            "nouveau": bool(ref.get("nouveau")),
            "pepite": is_pepite(ref, pepites),
            "stock": stock,
        })

    if vinis:
        log(f"Matching Vinistoria : {matched}/{len(items)} "
            f"({100 * matched / max(len(items), 1):.0f}%).")

    return {
        "meta": {
            "total": len(items),
            "date_maj": date.today().isoformat(),
            "edition": edition_label,
            "edito": edito,
        },
        "items": items,
    }


# ===================================================================
# Main
# ===================================================================

def main():
    ap = argparse.ArgumentParser(description="Génère tarif.json depuis l'Excel maître VINOM.")
    ap.add_argument("--excel", required=True, help="Fichier Excel maître (.xlsx)")
    ap.add_argument("--vinistoria", default="", help="Export Vinistoria (.csv) — optionnel")
    ap.add_argument("--output", default="tarif.json", help="Fichier de sortie JSON")
    ap.add_argument("--edition", default="", help="Libellé d'édition (ex. 'Mai 2026')")
    args = ap.parse_args()

    # Édition : si non fournie, on déduit du mois courant
    if args.edition:
        edition_label = args.edition
    else:
        mois = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet",
                "Août", "Septembre", "Octobre", "Novembre", "Décembre"]
        t = date.today()
        edition_label = f"{mois[t.month - 1]} {t.year}"

    edito = ("À l'approche des beaux jours, votre carte des vins retrouve "
             "naturellement des allures ensoleillées. C'est la saison idéale "
             "pour redécouvrir nos rosés de Provence, nos Chablis frais et "
             "minéraux, et l'ensemble de notre sélection actuelle. Bonne "
             "lecture et bonnes dégustations.")

    log(f"Lecture de {args.excel}")
    refs, wb = parse_tarif_sheet(args.excel)

    # Garde-fou anti-publication-cassée
    if len(refs) < MIN_REFERENCES:
        fail(f"seulement {len(refs)} références extraites (seuil minimal : "
             f"{MIN_REFERENCES}). Publication annulée pour éviter un catalogue "
             f"incomplet. Vérifiez le fichier Excel (bonne feuille ? bon format ?).")

    couleur_index, pepites = build_gdd_indexes(wb)
    vinis = load_vinistoria(args.vinistoria)

    data = build_json(refs, couleur_index, pepites, vinis, edition_label, edito)

    try:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    except Exception as e:
        fail(f"écriture de {args.output} impossible : {e}")

    log(f"OK — {data['meta']['total']} références écrites dans {args.output} "
        f"(édition {edition_label}).")
    sys.exit(0)


if __name__ == "__main__":
    main()
