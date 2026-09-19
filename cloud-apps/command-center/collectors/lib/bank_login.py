import os
import subprocess
from pathlib import Path

CLI = Path.home() / 'orca' / 'moneyclaw' / 'plaid-server' / 'bank-login-cli.mjs'
NODE = '/opt/homebrew/bin/node'
PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'


def handle(kind, payload):
    if kind == 'bank.scan_now':
        return start_scan(payload or {})
    return False, 'unknown action %s' % kind


def start_scan(payload):
    node = os.environ.get('NODE') or NODE
    cli = os.environ.get('BANK_LOGIN_CLI') or str(CLI)
    extra = ['--account', str(payload['account'])] if payload.get('account') else []
    env = os.environ.copy()
    env['PATH'] = PATH + ':' + env.get('PATH', '')
    try:
        subprocess.Popen(
            [node, cli, *extra],
            start_new_session=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=env,
        )
    except FileNotFoundError:
        return False, 'Bank scan failed'
    return True, 'Bank scan started'
