import socket


def source(machine):
    return 'agents_mac' if machine == 'mac' else 'agents_gpu2'


def collect(machine):
    return {'machine': machine, 'hostname': socket.gethostname(), 'ok': True}
