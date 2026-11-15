#!/usr/bin/env python3
"""Estimate past uptime from the API server's nginx logs, for the days
before the monitor ran. Run it on the VPS:

    sudo python3 backfill_nginx.py > backfill.json

It prints only per-day counts (no addresses, no paths), in the shape of
data/daily.json, every entry marked "estimate". Website is not covered:
it is served by Netlify, not this server.

Each 5-minute slot is judged from the requests in it:
  api     /v1/* (not /play) answered mostly without 5xx
  stream  /v1/play answered mostly without 5xx
  auth    /v1/auth/* answered mostly without 5xx
  live    /ws upgrades answered mostly 101
A slot with no API request at all, while the hour around it was busy,
counts as down for every component (the server did not answer anyone).
Slots with nothing to judge are left out.
"""
import gzip
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone

API_LOG = sys.argv[1] if len(sys.argv) > 1 else '/var/log/nginx/hanaminime_access.log'
WS_LOG = sys.argv[2] if len(sys.argv) > 2 else '/var/log/nginx/hanaminime_ws_access.log'
DAYS = 90
SLOT = 300
WIB = timezone(timedelta(hours=7))

LINE = re.compile(r'\[(\d{2}/\w{3}/\d{4}:\d{2}:\d{2}:\d{2} [+-]\d{4})\] "(\w+) (\S+)[^"]*" (\d{3})')
since = datetime.now(timezone.utc) - timedelta(days=DAYS + 1)
today = datetime.now(WIB).date().isoformat()


def lines(path):
    opener = gzip.open if path.endswith('.gz') else open
    try:
        with opener(path, 'rt', errors='replace') as f:
            yield from f
    except FileNotFoundError:
        return


# slot -> component -> [total, bad]
slots = defaultdict(lambda: defaultdict(lambda: [0, 0]))


def read(path, ws):
    for raw in lines(path):
        m = LINE.search(raw)
        if not m:
            continue
        when = datetime.strptime(m.group(1), '%d/%b/%Y:%H:%M:%S %z')
        if when < since:
            continue
        method, target, status = m.group(2), m.group(3), int(m.group(4))
        slot = int(when.timestamp()) // SLOT
        if ws:
            if target.startswith('/ws'):
                c = slots[slot]['live']
                c[0] += 1
                c[1] += status != 101 and status >= 500
            continue
        if method == 'OPTIONS' or not target.startswith('/v1/'):
            continue
        comp = 'stream' if target.startswith('/v1/play') else 'auth' if target.startswith('/v1/auth/') else 'api'
        for name in {comp, 'api'} if comp == 'auth' else {comp}:
            c = slots[slot][name]
            c[0] += 1
            c[1] += status >= 500


read(API_LOG, ws=False)
read(WS_LOG, ws=True)

if not slots:
    sys.exit('no requests found in the window')

first, last = min(slots), max(slots)
api_count = {s: slots[s]['api'][0] if s in slots else 0 for s in range(first, last + 1)}

daily = defaultdict(dict)


def mark(comp, slot, ok):
    day = datetime.fromtimestamp(slot * SLOT, WIB).date().isoformat()
    if day >= today:
        return  # today belongs to the live monitor
    d = daily[comp].setdefault(day, {'checks': 0, 'fails': 0, 'estimate': True})
    d['checks'] += 1
    d['fails'] += 0 if ok else 1


# Runs of slots with no API request: down when the hour before and the hour
# after were busy (the server answered nobody in between).
down = set()
s = first
while s <= last:
    if api_count.get(s, 0):
        s += 1
        continue
    end = s
    while end + 1 <= last and not api_count.get(end + 1, 0):
        end += 1
    edges = [api_count.get(x, 0) for x in list(range(s - 12, s)) + list(range(end + 1, end + 13))]
    if sum(1 for n in edges if n > 0) >= 20 and sum(edges) / len(edges) >= 4:
        down.update(range(s, end + 1))
    s = end + 1

# Every component is judged on the same slots: one where the API answered
# normally counts as up for the others too, unless they show their own 5xx.
for s in range(first, last + 1):
    if s in down:
        for comp in ('api', 'stream', 'auth', 'live'):
            mark(comp, s, False)
        continue
    got = slots.get(s, {})
    api_total, api_bad = got.get('api', (0, 0))
    if not api_total:
        total, bad = got.get('live', (0, 0))  # before the /v1 API: the socket only
        if total:
            mark('live', s, bad * 2 <= total)
        continue
    api_ok = api_bad * 2 <= api_total
    mark('api', s, api_ok)
    for comp in ('stream', 'auth', 'live'):
        total, bad = got.get(comp, (0, 0))
        mark(comp, s, bad * 2 <= total if total else api_ok)

json.dump(daily, sys.stdout, separators=(',', ':'))
runs = []
for x in sorted(down):
    if runs and x == runs[-1][1] + 1:
        runs[-1][1] = x
    else:
        runs.append([x, x])
print(file=sys.stderr)
print('Rentang tanpa jawaban server (WIB):', file=sys.stderr)
for a_, b_ in runs:
    start = datetime.fromtimestamp(a_ * SLOT, WIB)
    print(f'  {start:%Y-%m-%d %H:%M}  {(b_ - a_ + 1) * 5:5d} menit', file=sys.stderr)
print(file=sys.stderr)
for comp, days in sorted(daily.items()):
    checks = sum(d['checks'] for d in days.values())
    fails = sum(d['fails'] for d in days.values())
    print(f'{comp:7} {len(days):3} hari  {checks:6} slot  {fails:4} gagal  ~{100 - fails * 100 / max(checks, 1):.2f}%', file=sys.stderr)
