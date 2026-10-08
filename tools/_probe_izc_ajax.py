#!/usr/bin/env python3
import json
import re
import urllib.parse
import urllib.request

UA = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": "https://izc.com.co/es/catalogsearch/result/?q=LS1203",
}

candidates = [
    "https://izc.com.co/es/catalogsearch/result/?q=LS1203&ajax=1",
    "https://izc.com.co/es/catalogsearch/result/index/?q=LS1203&ajax=1",
    "https://izc.com.co/graphql",
]

# Try GraphQL products
gql = {
    "query": '{ products(filter: {sku: {eq: "5613"}}, pageSize: 5) { items { sku name url_key small_image { url } image { url } } } }'
}
req = urllib.request.Request(
    "https://izc.com.co/graphql",
    data=json.dumps(gql).encode(),
    headers={**UA, "Content-Type": "application/json"},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=30) as r:
        print("GQL sku", r.read()[:500])
except Exception as e:
    print("GQL ERR", e)

gql2 = {
    "query": '{ products(search: "LS1203", pageSize: 5) { items { sku name url_key small_image { url } image { url } } total_count } }'
}
req = urllib.request.Request(
    "https://izc.com.co/graphql",
    data=json.dumps(gql2).encode(),
    headers={**UA, "Content-Type": "application/json"},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=30) as r:
        print("GQL search", r.read()[:800])
except Exception as e:
    print("GQL2 ERR", e)

for u in candidates[:2]:
    try:
        req = urllib.request.Request(u, headers=UA)
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read().decode("utf-8", "replace")
        print("AJAX", u, "len", len(body), "ct", r.headers.get("Content-Type"))
        print(body[:300].replace("\n", " "))
    except Exception as e:
        print("AJAX ERR", u, e)
