def source(machine):
    return 'sponsors'


def collect(machine):
    try:
        from sponsors import collect_snapshot
        return collect_snapshot()
    except Exception as e:
        return {'ok': False, 'error': type(e).__name__}
