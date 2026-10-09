#!/usr/bin/env python3
"""Reveille le PC par Wake-on-LAN depuis le NAS.

    python3 reveille-pc.py              reveille le PC de `pc.conf`
    python3 reveille-pc.py --essai      montre le paquet sans l envoyer
    python3 reveille-pc.py <MAC>        vise une autre machine

⚠️ LE PAQUET MAGIQUE EST DE NIVEAU 2. Il n a pas d adresse IP de destination
utile : la carte endormie n a pas d IP, elle ecoute seulement passer une trame
contenant six octets 0xFF suivis de seize repetitions de son adresse MAC. On
l envoie donc en DIFFUSION sur le reseau local, et l emetteur doit se trouver
sur le MEME segment que la cible — d ou le NAS, allume en permanence.

⚠️ TROIS ENVOIS, pas un. Un paquet UDP en diffusion peut se perdre sans que
rien ne le signale, et il n existe aucun accuse de reception : le seul retour
possible est que la machine s allume. Trois envois espaces coutent trois
millisecondes et evitent d avoir a se demander si le paquet est parti.
"""
import os
import socket
import sys
import time


def conf():
    """Le poste vise vient de `pc.conf`, a cote du script (PC_MAC, PC_DIFFUSION) :
    le meme fichier que lisent `pc-watch.sh` et `collect.sh`."""
    c = {}
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "pc.conf"), encoding="utf-8") as f:
            for l in f:
                k, egal, v = l.strip().partition("=")
                if egal and not k.startswith("#"):
                    c[k.strip()] = v.strip().strip("\"'")
    except OSError:
        pass
    return c


C = conf()
# ⚠️ La MAC de la carte INTEGREE a la carte mere : Intel ne prend pas en charge
# le WoL sur ses cartes 10GbE en PCIe.
MAC_DEFAUT = C.get("PC_MAC", "")

# Le port n a aucune importance pour la carte, qui inspecte la trame et non
# l en-tete UDP. 9 est la convention (discard), 7 s emploie aussi.
PORT = 9
DIFFUSIONS = ["255.255.255.255"] + ([C["PC_DIFFUSION"]] if C.get("PC_DIFFUSION") else [])


def trame(mac: str) -> bytes:
    brut = mac.replace(":", "").replace("-", "").replace(".", "")
    if len(brut) != 12:
        raise SystemExit("MAC invalide : %r (12 chiffres hexadecimaux attendus)" % mac)
    octets = bytes.fromhex(brut)
    return b"\xff" * 6 + octets * 16


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    essai = "--essai" in sys.argv
    mac = args[0] if args else MAC_DEFAUT
    if not mac:
        raise SystemExit("aucune MAC : PC_MAC absent de pc.conf, et aucune donnee en argument")

    paquet = trame(mac)
    print("  cible  : %s" % mac.upper())
    print("  paquet : %d octets" % len(paquet))

    if essai:
        print("  diffusion : %s" % ", ".join(DIFFUSIONS))
        print("  essai a blanc, rien n a ete envoye")
        return 0

    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    envoyes = 0
    for _ in range(3):
        for adr in DIFFUSIONS:
            try:
                s.sendto(paquet, (adr, PORT))
                envoyes += 1
            except OSError as e:
                print("  echec vers %s : %s" % (adr, e))
        time.sleep(0.15)
    s.close()

    print("  %d paquets envoyes sur le port %d" % (envoyes, PORT))
    print("  Aucun accuse de reception n existe : la seule preuve est que le PC demarre.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
