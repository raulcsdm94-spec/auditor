import re
import json
import requests
import pandas as pd
from bs4 import BeautifulSoup

EMAIL_REGEX = r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"

BLACKLIST = [

    # Redes sociais
    "facebook.com",
    "fb.com",
    "instagram.com",
    "linkedin.com",
    "twitter.com",
    "x.com",
    "youtube.com",
    "tiktok.com",
    "pinterest.com",

    # Google
    "google.",
    "maps.google",
    "goo.gl",

    # Viagens
    "booking.com",
    "tripadvisor",
    "expedia",
    "hotels.com",
    "bluepillow",
    "hoteisdirect",
    "trivago",
    "kayak",
    "agoda",
    "airbnb",
    "vrbo",

    # Restaurantes
    "thefork",
    "eatbu",
    "ubereats",
    "glovo",
    "justeat",
    "just-eat",
    "zomato",

    # DiretÃ³rios
    "restaurantguru",
    "restaurantji",
    "restaurantsinportugal",
    "restaurantes.pt",
    "yelp",
    "foursquare",
    "yellowpages",

    # Guias
    "umarella",
    "timeout",
    "visitportugal",
    "visitlisboa",
    "wikivoyage",
    "wikipedia",

    # Blogs
    "blogspot",
    "wordpress.com",
    "medium.com",

    # Marketplaces
    "idealista",
    "olx",
    "imovirtual",

    # Reservas
    "quandoo",
    "opentable",
    "resy",
]

GOOD_PREFIXES = [
    "geral@",
    "info@",
    "reservas@",
    "booking@",
    "contacto@",
    "contact@",
    "hello@",
    "office@",
    "recepcao@",
    "rececao@",
    "mail@",
]

BAD_PREFIXES = [
    "noreply@",
    "no-reply@",
    "donotreply@",
    "wordpress@",
    "abuse@",
    "privacy@",
    "gdpr@",
    "admin@",
    "webmaster@",
    "hostmaster@",
    "support@",
    "cloudflare@",
]

headers = {
    "User-Agent": "Mozilla/5.0"
}

# Tipos schema.org que são estrutura da página (nunca uma categoria de negócio)
IGNORE_TYPES = {
    "website",
    "webpage",
    "webpageelement",
    "breadcrumblist",
    "sitenavigationelement",
    "listitem",
    "imageobject",
    "person",
    "searchaction",
    "webapplication",
    "collectionpage",
    "itemlist",
    "article",
    "blogposting",
    "newsarticle",
    "offer",
    "aggregateoffer",
    "aggregaterating",
    "review",
    "rating",
    "postaladdress",
    "geocoordinates",
    "openinghoursspecification",
    "menu",
    "menuitem",
    "menusection",
    "product",
    "service",
    "brand",
    "logo",
    "contactpoint",
    "faqpage",
    "question",
    "answer",
    "event",
    "thing",
}

# Tipos genéricos: só servem de recurso se não houver nada mais específico
GENERIC_TYPES = {
    "organization",
    "localbusiness",
    "corporation",
    "store",
}

# Código postal português (ex.: 1000-001 Lisboa) usado como último recurso
POSTAL_REGEX = r"\b\d{4}-\d{3}\b[\s,]*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .'-]{1,40})"


def iter_jsonld(soup):
    """Percorre todos os blocos JSON-LD e devolve cada objeto (segue @graph)."""

    for tag in soup.find_all("script", type="application/ld+json"):

        raw = tag.string or tag.get_text()

        if not raw:
            continue

        try:
            data = json.loads(raw)
        except Exception:
            continue

        stack = [data]

        while stack:

            node = stack.pop()

            if isinstance(node, list):
                stack.extend(node)

            elif isinstance(node, dict):

                graph = node.get("@graph")

                if isinstance(graph, list):
                    stack.extend(graph)

                yield node


def node_types(node):
    """Devolve os @type de um objeto JSON-LD como lista de strings."""

    t = node.get("@type")

    if isinstance(t, str):
        return [t]

    if isinstance(t, list):
        return [x for x in t if isinstance(x, str)]

    return []


def address_locality(address):
    """Extrai a cidade (addressLocality) de um campo address do JSON-LD."""

    if isinstance(address, list):

        for a in address:

            loc = address_locality(a)

            if loc:
                return loc

    elif isinstance(address, dict):

        return (
            address.get("addressLocality")
            or address.get("addressRegion")
        )

    return None


def humanize_type(t):
    """CafeOrCoffeeShop -> Cafe Or Coffee Shop"""

    return re.sub(r"(?<=[a-z])(?=[A-Z])", " ", t).strip()


def extract_category(objects):
    """Categoria do negócio a partir do @type do JSON-LD."""

    especifico = None
    generico = None

    for node in objects:

        for t in node_types(node):

            key = t.lower()

            if key in IGNORE_TYPES:
                continue

            if key in GENERIC_TYPES:

                if generico is None:
                    generico = t

                continue

            if especifico is None:
                especifico = t

    tipo = especifico or generico

    if tipo:
        return humanize_type(tipo)

    return ""


def clean_city(value):
    """Limpa o nome da cidade (corta texto colado, remove sufixo de país)."""

    if not value:
        return ""

    # corta em pontuação, quebras de linha ou dígitos (texto colado indevido)
    value = re.split(r"[\n\r,.;:<0-9]", value)[0]

    value = re.sub(r"\s+", " ", value).strip()

    # remove sufixo de país (ex.: "Braga Portugal" -> "Braga")
    value = re.sub(r"[\s-]+Portugal$", "", value, flags=re.IGNORECASE)

    value = value.strip(" -").strip()

    if value.lower() in ("portugal", ""):
        return ""

    return value


def extract_city(objects, soup, html):
    """Cidade: 1) JSON-LD  2) meta og:locality  3) código postal (fallback)."""

    raw = ""

    # 1) endereço no JSON-LD
    for node in objects:

        loc = address_locality(node.get("address"))

        if isinstance(loc, str) and loc.strip():
            raw = loc
            break

    # 2) meta tags
    if not raw:

        for prop in ("og:locality", "business:contact_data:locality"):

            tag = soup.find("meta", attrs={"property": prop})

            if tag and tag.get("content", "").strip():
                raw = tag["content"]
                break

    # 3) código postal português
    if not raw:

        m = re.search(POSTAL_REGEX, html)

        if m:
            raw = m.group(1)

    return clean_city(raw)


df = pd.read_csv("websites.csv")

results = []

for website in df["website"]:

    website = str(website).strip()

    if website == "":
        continue

    website_lower = website.lower()

    if any(x in website_lower for x in BLACKLIST):
        print(f"â Ignorado: {website}")
        continue

    print(f"ð {website}")

    emails = []

    try:

        response = requests.get(
            website,
            headers=headers,
            timeout=15,
            allow_redirects=True
        )

        html = response.text

        soup = BeautifulSoup(html, "html.parser")

        # mailto
        for a in soup.find_all("a", href=True):

            href = a["href"]

            if href.startswith("mailto:"):

                email = href.replace("mailto:", "").split("?")[0].lower()

                if email not in emails:
                    emails.append(email)

        # Emails escritos no HTML
        for email in re.findall(EMAIL_REGEX, html):

            email = email.lower()

            if email not in emails:
                emails.append(email)

    except Exception:
        continue

    # Limpeza
    emails = [

        e for e in emails

        if not any(x in e for x in [
            ".png",
            ".jpg",
            ".jpeg",
            ".gif",
            ".svg",
            "example.com"
        ])

    ]

    if not emails:
        continue

    # Remove emails maus
    bons = []

    for e in emails:

        if any(e.startswith(x) for x in BAD_PREFIXES):
            continue

        bons.append(e)

    if bons:
        emails = bons

    escolhido = None

    # DÃ¡ prioridade aos emails bons
    for prefix in GOOD_PREFIXES:

        for e in emails:

            if e.startswith(prefix):
                escolhido = e
                break

        if escolhido:
            break

    # Caso contrÃ¡rio escolhe o primeiro
    if not escolhido:
        escolhido = emails[0]

    # Cidade e categoria (a partir do conteúdo já descarregado)
    jsonld = list(iter_jsonld(soup))

    cidade = extract_city(jsonld, soup, html)

    categoria = extract_category(jsonld)

    print(f"   -> {escolhido} | {cidade or '-'} | {categoria or '-'}")

    results.append({
        "website": website,
        "email": escolhido,
        "city": cidade,
        "category": categoria,
    })

pd.DataFrame(results).to_csv(
    "emails.csv",
    index=False,
    sep=";",
    encoding="utf-8-sig"
)

print()
print("=" * 40)
print(f"Empresas com email: {len(results)}")
print("=" * 40)