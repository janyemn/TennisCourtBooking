"""Only forward the selected mini-program's login headers while locally paired.
Never log or store traffic, passwords, request bodies or response bodies.
"""
import asyncio
import json
import time
from pathlib import Path
from http.cookies import SimpleCookie
from urllib.request import Request, build_opener, ProxyHandler
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parents[1]
PAIR = ROOT / '.local' / 'session-sync-pair.json'
ALLOWED = ('cookie', 'app-version', 'referer', 'user-agent', 'x-page-uuid')
LOG = ROOT / '.local' / 'session-sync-diagnostics.jsonl'

def trace(event, **fields):
    # Only call with fixed labels, booleans and HTTP status numbers, never headers.
    try:
        if LOG.exists() and LOG.stat().st_size > 100000:
            LOG.write_text('', encoding='utf-8')
        with LOG.open('a', encoding='utf-8') as out:
            out.write(json.dumps({'at':time.time(),'event':event,**fields})+'\n')
    except OSError:
        pass

def envelope(flow, pair):
    req = flow.request
    if pair.get('expiresAt', 0) <= time.time()*1000:
        return None
    if req.scheme != 'https' or req.host != 'nswtt.rim20.com':
        return None
    path = req.path.split('?')[0]
    if path not in ('/api/wtt/user/wttauth/login', '/api/wtt/user/wttauth/info'):
        return None
    if flow.response.status_code != 200:
        return None
    headers = {k: req.headers[k] for k in ALLOWED if k in req.headers}
    if not headers.get('referer', '').startswith('https://servicewechat.com/wx9f30f1cea85e1e8c/'):
        return None
    jar = SimpleCookie()
    jar.load(headers.get('cookie', ''))
    for line in flow.response.headers.get_all('set-cookie'):
        cookies = SimpleCookie(); cookies.load(line)
        for key, morsel in cookies.items():
            if morsel['path'] != '/' or morsel['domain'].lstrip('.') not in ('', 'rim20.com', 'nswtt.rim20.com'):
                continue
            if morsel['max-age'] == '0':
                jar.pop(key, None)
            else:
                jar[key] = morsel.value
    if not jar.get('sid') or not jar['sid'].value:
        return None
    headers['cookie'] = '; '.join(k+'='+v.value for k,v in jar.items())
    return {'origin':'https://nswtt.rim20.com','path':path,'headers':headers}

def forward(data, pair):
    req=Request('http://127.0.0.1:3827/api/session-sync/receive',
        data=json.dumps(data).encode(),headers={'Content-Type':'application/json','X-Sync-Token':pair['token']})
    # Never route the private local handoff through an environment/system proxy.
    with build_opener(ProxyHandler({})).open(req, timeout=15) as response:
        response.read(4096)

class SessionSync:
    def __init__(self):
        self.busy=False
        trace('addon_loaded')
    def error(self, flow):
        if flow.request and flow.request.host == 'nswtt.rim20.com':
            trace('target_network_error')
    def tls_failed_client(self, data):
        if data.context.server.address and data.context.server.address[0] == 'nswtt.rim20.com':
            trace('target_client_tls_failed')
    async def response(self, flow):
        if self.busy:
            return
        try:
            pair=json.loads(PAIR.read_text(encoding='utf-8'))
            if pair.get('expiresAt',0)>time.time()*1000 and flow.request.host=='nswtt.rim20.com':
                trace('target_response',login_path=flow.request.path.split('?')[0] in ('/api/wtt/user/wttauth/login','/api/wtt/user/wttauth/info'),has_cookie=bool(flow.request.headers.get('cookie')),correct_ref=flow.request.headers.get('referer','').startswith('https://servicewechat.com/wx9f30f1cea85e1e8c/'),status=flow.response.status_code)
            data=envelope(flow,pair)
            if data is None:
                return
            self.busy=True
            trace('forward_start')
            await asyncio.to_thread(forward,data,pair)
            trace('forward_success')
        except HTTPError as error:
            trace('forward_rejected',status=error.code)
        except Exception as error:
            # No values from traffic or exceptions are printed to the proxy log.
            trace('sync_error',kind=type(error).__name__)
        finally:
            self.busy=False

addons=[SessionSync()]
