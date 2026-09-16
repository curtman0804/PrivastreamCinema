#!/usr/bin/env python3

import argparse
import base64
import binascii
import hmac
import http.server
import ipaddress
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
import urllib.parse
import uuid


EXPECTED_BIND = "127.0.0.1"
EXPECTED_PORT = 17390

EXPECTED_INTERFACE = "privastream"

EXPECTED_SERVER_PUBLIC_KEY = (
    "3jjiq7KenZnOBPq/C0kxfPNr7oGFNv8ZaZqgWVOXLxU="
)

EXPECTED_ENDPOINT = (
    "vpn.privastreamsolutions.com:51820"
)

EXPECTED_ALLOWED_IPS = (
    "0.0.0.0/0, ::/0"
)

EXPECTED_KEEPALIVE = 25

DEFAULT_DB = (
    "/var/lib/privastream-tunnel-control/"
    "peers.sqlite3"
)

DEFAULT_TOKEN_FILE = (
    "/etc/privastream-tunnel-control/"
    "control.token"
)

DEFAULT_PUBLIC_KEY_FILE = (
    "/etc/wireguard/"
    "privastream-server.pub"
)

WG_BINARY = "/usr/bin/wg"

MIN_SLOT = 257
MAX_SLOT = 65534

MAX_BODY = 8192

USER_ID_RE = re.compile(
    r"^[A-Za-z0-9._:@-]{1,128}$"
)


SCHEMA = """
CREATE TABLE IF NOT EXISTS peers (
    device_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    public_key TEXT NOT NULL UNIQUE,
    slot INTEGER NOT NULL UNIQUE
        CHECK(slot >= 257 AND slot <= 65534),
    ipv4 TEXT NOT NULL UNIQUE,
    ipv6 TEXT NOT NULL UNIQUE,
    platform TEXT,
    app_version TEXT,
    active INTEGER NOT NULL DEFAULT 1
        CHECK(active IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_peers_user_id
ON peers(user_id);

CREATE INDEX IF NOT EXISTS idx_peers_active
ON peers(active);
"""


class RequestError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = int(status)
        self.message = str(message)


def validate_public_key(value):
    value = str(value or "").strip()

    try:
        decoded = base64.b64decode(
            value,
            validate=True,
        )
    except (ValueError, binascii.Error):
        raise ValueError(
            "invalid WireGuard public key"
        )

    if len(decoded) != 32:
        raise ValueError(
            "invalid WireGuard public key length"
        )

    canonical = base64.b64encode(
        decoded
    ).decode("ascii")

    if not hmac.compare_digest(
        value,
        canonical,
    ):
        raise ValueError(
            "non-canonical WireGuard public key"
        )

    return canonical


def validate_device_id(value):
    raw = str(value or "").strip()

    try:
        parsed = uuid.UUID(raw)
    except Exception:
        raise ValueError(
            "invalid device id"
        )

    canonical = str(parsed)

    if raw != canonical:
        raise ValueError(
            "device id must be canonical UUID"
        )

    return canonical


def validate_user_id(value):
    value = str(value or "").strip()

    if not USER_ID_RE.fullmatch(value):
        raise ValueError(
            "invalid user id"
        )

    return value


def optional_text(value, max_length):
    if value is None:
        return None

    value = str(value).strip()

    if not value:
        return None

    if len(value) > max_length:
        raise ValueError(
            "metadata field too long"
        )

    if any(
        ord(character) < 32
        for character in value
    ):
        raise ValueError(
            "metadata contains control characters"
        )

    return value


def slot_to_ipv4(slot):
    if slot < MIN_SLOT or slot > MAX_SLOT:
        raise ValueError(
            "slot outside IPv4 allocation range"
        )

    third = slot // 256
    fourth = slot % 256

    return (
        f"10.197.{third}.{fourth}"
    )


def slot_to_ipv6(slot):
    if slot < MIN_SLOT or slot > MAX_SLOT:
        raise ValueError(
            "slot outside IPv6 allocation range"
        )

    return str(
        ipaddress.IPv6Address(
            int(
                ipaddress.IPv6Address(
                    "fd73:739:1::"
                )
            )
            + slot
        )
    )


def validate_dns(value, require_dns):
    raw = str(value or "").strip()

    if not raw:
        if require_dns:
            raise RuntimeError(
                "client DNS is not configured"
            )

        return ""

    parts = [
        item.strip()
        for item in raw.split(",")
        if item.strip()
    ]

    if not parts or len(parts) > 4:
        raise RuntimeError(
            "invalid DNS configuration"
        )

    canonical = []

    for item in parts:
        canonical.append(
            str(
                ipaddress.ip_address(
                    item
                )
            )
        )

    return ", ".join(canonical)


def read_required_file(path):
    with open(
        path,
        "r",
        encoding="utf-8",
    ) as handle:
        value = handle.read().strip()

    if not value:
        raise RuntimeError(
            "required file is empty"
        )

    return value


def load_config(require_dns=True):
    bind = os.environ.get(
        "PRIVASTREAM_TUNNEL_BIND",
        EXPECTED_BIND,
    ).strip()

    if bind != EXPECTED_BIND:
        raise RuntimeError(
            "control service must bind to loopback"
        )

    port = int(
        os.environ.get(
            "PRIVASTREAM_TUNNEL_PORT",
            str(EXPECTED_PORT),
        )
    )

    if port != EXPECTED_PORT:
        raise RuntimeError(
            "unexpected control port"
        )

    interface = os.environ.get(
        "PRIVASTREAM_TUNNEL_INTERFACE",
        EXPECTED_INTERFACE,
    ).strip()

    if interface != EXPECTED_INTERFACE:
        raise RuntimeError(
            "unexpected WireGuard interface"
        )

    db_path = os.environ.get(
        "PRIVASTREAM_TUNNEL_DB",
        DEFAULT_DB,
    ).strip()

    token_file = os.environ.get(
        "PRIVASTREAM_TUNNEL_TOKEN_FILE",
        DEFAULT_TOKEN_FILE,
    ).strip()

    public_key_file = os.environ.get(
        "PRIVASTREAM_TUNNEL_SERVER_PUBLIC_KEY_FILE",
        DEFAULT_PUBLIC_KEY_FILE,
    ).strip()

    endpoint = os.environ.get(
        "PRIVASTREAM_TUNNEL_ENDPOINT",
        EXPECTED_ENDPOINT,
    ).strip()

    if endpoint != EXPECTED_ENDPOINT:
        raise RuntimeError(
            "unexpected tunnel endpoint"
        )

    allowed_ips = os.environ.get(
        "PRIVASTREAM_TUNNEL_ALLOWED_IPS",
        EXPECTED_ALLOWED_IPS,
    ).strip()

    if allowed_ips != EXPECTED_ALLOWED_IPS:
        raise RuntimeError(
            "full-tunnel routes are required"
        )

    keepalive = int(
        os.environ.get(
            "PRIVASTREAM_TUNNEL_KEEPALIVE",
            str(EXPECTED_KEEPALIVE),
        )
    )

    if keepalive != EXPECTED_KEEPALIVE:
        raise RuntimeError(
            "unexpected keepalive"
        )

    dns = validate_dns(
        os.environ.get(
            "PRIVASTREAM_TUNNEL_DNS",
            "",
        ),
        require_dns=require_dns,
    )

    server_public_key = (
        validate_public_key(
            read_required_file(
                public_key_file
            )
        )
    )

    if not hmac.compare_digest(
        server_public_key,
        EXPECTED_SERVER_PUBLIC_KEY,
    ):
        raise RuntimeError(
            "server public key does not match pin"
        )

    token = read_required_file(
        token_file
    )

    if len(token) < 32:
        raise RuntimeError(
            "control token is too short"
        )

    return {
        "bind": bind,
        "port": port,
        "interface": interface,
        "db_path": db_path,
        "token": token,
        "server_public_key":
            server_public_key,
        "endpoint": endpoint,
        "allowed_ips": allowed_ips,
        "persistent_keepalive":
            keepalive,
        "dns": dns,
    }


def init_db(path):
    parent = os.path.dirname(
        path
    )

    if parent:
        os.makedirs(
            parent,
            mode=0o700,
            exist_ok=True,
        )

    connection = sqlite3.connect(
        path,
        timeout=10,
    )

    try:
        connection.executescript(
            SCHEMA
        )

        connection.commit()

    finally:
        connection.close()


def interface_is_active(interface):
    result = subprocess.run(
        [
            WG_BINARY,
            "show",
            interface,
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )

    return result.returncode == 0


def configure_peer(
    interface,
    public_key,
    ipv4,
    ipv6,
):
    result = subprocess.run(
        [
            WG_BINARY,
            "set",
            interface,
            "peer",
            public_key,
            "allowed-ips",
            (
                f"{ipv4}/32,"
                f"{ipv6}/128"
            ),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )

    if result.returncode != 0:
        raise RequestError(
            503,
            "tunnel interface unavailable",
        )


def remove_peer_best_effort(
    interface,
    public_key,
):
    subprocess.run(
        [
            WG_BINARY,
            "set",
            interface,
            "peer",
            public_key,
            "remove",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )


def list_runtime_peers(interface):
    result = subprocess.run(
        [
            WG_BINARY,
            "show",
            interface,
            "peers",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        check=False,
    )

    if result.returncode != 0:
        raise RequestError(
            503,
            "tunnel interface unavailable",
        )

    return {
        line.strip()
        for line in result.stdout.splitlines()
        if line.strip()
    }


def remove_peer(
    interface,
    public_key,
):
    result = subprocess.run(
        [
            WG_BINARY,
            "set",
            interface,
            "peer",
            public_key,
            "remove",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )

    if result.returncode != 0:
        raise RequestError(
            503,
            "tunnel interface unavailable",
        )


def reconcile_peers(config):
    if not interface_is_active(
        config["interface"]
    ):
        raise RuntimeError(
            "tunnel interface unavailable"
        )

    connection = sqlite3.connect(
        config["db_path"],
        timeout=10,
    )

    connection.row_factory = sqlite3.Row

    connection.execute(
        "PRAGMA busy_timeout = 10000"
    )

    try:
        rows = connection.execute(
            """
            SELECT
                public_key,
                ipv4,
                ipv6,
                active
            FROM peers
            ORDER BY slot
            """
        ).fetchall()

    finally:
        connection.close()

    active_keys = set()
    configured = 0

    for row in rows:
        if int(row["active"]) != 1:
            continue

        configure_peer(
            config["interface"],
            str(row["public_key"]),
            str(row["ipv4"]),
            str(row["ipv6"]),
        )

        active_keys.add(
            str(row["public_key"])
        )

        configured += 1

    runtime_peers = list_runtime_peers(
        config["interface"]
    )

    removed = 0

    for public_key in sorted(
        runtime_peers - active_keys
    ):
        remove_peer(
            config["interface"],
            public_key,
        )

        removed += 1

    return {
        "active": configured,
        "removed": removed,
    }


def revoke_peer(
    config,
    user_id,
    device_id,
):
    connection = sqlite3.connect(
        config["db_path"],
        timeout=10,
        isolation_level=None,
    )

    connection.row_factory = sqlite3.Row

    connection.execute(
        "PRAGMA busy_timeout = 10000"
    )

    existing = None
    wg_removed = False

    try:
        connection.execute(
            "BEGIN IMMEDIATE"
        )

        existing = connection.execute(
            """
            SELECT
                device_id,
                user_id,
                public_key,
                ipv4,
                ipv6,
                active
            FROM peers
            WHERE device_id = ?
            """,
            (device_id,),
        ).fetchone()

        if existing is None:
            connection.execute(
                "COMMIT"
            )

            return {
                "revoked": True,
            }

        if existing["user_id"] != user_id:
            raise RequestError(
                409,
                "device ownership mismatch",
            )

        if interface_is_active(
            config["interface"]
        ):
            remove_peer(
                config["interface"],
                str(
                    existing["public_key"]
                ),
            )

            wg_removed = True

        connection.execute(
            """
            UPDATE peers
            SET
                active = 0,
                updated_at = ?
            WHERE device_id = ?
            """,
            (
                int(time.time()),
                device_id,
            ),
        )

        connection.execute(
            "COMMIT"
        )

        return {
            "revoked": True,
        }

    except Exception:
        try:
            connection.execute(
                "ROLLBACK"
            )
        except Exception:
            pass

        if (
            existing is not None
            and wg_removed
            and int(
                existing["active"]
            ) == 1
            and interface_is_active(
                config["interface"]
            )
        ):
            try:
                configure_peer(
                    config["interface"],
                    str(
                        existing[
                            "public_key"
                        ]
                    ),
                    str(
                        existing["ipv4"]
                    ),
                    str(
                        existing["ipv6"]
                    ),
                )
            except Exception:
                pass

        raise

    finally:
        connection.close()


def allocate_slot(connection):
    rows = connection.execute(
        "SELECT slot FROM peers ORDER BY slot"
    ).fetchall()

    used = {
        int(row[0])
        for row in rows
    }

    for slot in range(
        MIN_SLOT,
        MAX_SLOT + 1,
    ):
        if slot not in used:
            return slot

    raise RequestError(
        503,
        "tunnel address pool exhausted",
    )


def provision_peer(
    config,
    user_id,
    device_id,
    public_key,
    platform,
    app_version,
):
    if not interface_is_active(
        config["interface"]
    ):
        raise RequestError(
            503,
            "tunnel interface unavailable",
        )

    connection = sqlite3.connect(
        config["db_path"],
        timeout=10,
        isolation_level=None,
    )

    connection.row_factory = sqlite3.Row

    connection.execute(
        "PRAGMA busy_timeout = 10000"
    )

    new_peer = False
    wg_applied = False
    existing = None
    existing_active = None

    try:
        connection.execute(
            "BEGIN IMMEDIATE"
        )

        existing = connection.execute(
            """
            SELECT
                device_id,
                user_id,
                public_key,
                slot,
                ipv4,
                ipv6,
                active
            FROM peers
            WHERE device_id = ?
            """,
            (device_id,),
        ).fetchone()

        now = int(
            time.time()
        )

        if existing is not None:
            if existing["user_id"] != user_id:
                raise RequestError(
                    409,
                    "device is already registered",
                )

            if not hmac.compare_digest(
                existing["public_key"],
                public_key,
            ):
                raise RequestError(
                    409,
                    "device public key changed",
                )

            existing_active = int(
                existing["active"]
            )

            slot = int(
                existing["slot"]
            )

            ipv4 = str(
                existing["ipv4"]
            )

            ipv6 = str(
                existing["ipv6"]
            )

        else:
            duplicate_key = (
                connection.execute(
                    """
                    SELECT device_id
                    FROM peers
                    WHERE public_key = ?
                    """,
                    (public_key,),
                ).fetchone()
            )

            if duplicate_key is not None:
                raise RequestError(
                    409,
                    "public key is already registered",
                )

            slot = allocate_slot(
                connection
            )

            ipv4 = slot_to_ipv4(
                slot
            )

            ipv6 = slot_to_ipv6(
                slot
            )

            new_peer = True

        configure_peer(
            config["interface"],
            public_key,
            ipv4,
            ipv6,
        )

        wg_applied = True

        if existing is None:
            connection.execute(
                """
                INSERT INTO peers (
                    device_id,
                    user_id,
                    public_key,
                    slot,
                    ipv4,
                    ipv6,
                    platform,
                    app_version,
                    active,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                """,
                (
                    device_id,
                    user_id,
                    public_key,
                    slot,
                    ipv4,
                    ipv6,
                    platform,
                    app_version,
                    now,
                    now,
                ),
            )

        else:
            connection.execute(
                """
                UPDATE peers
                SET
                    platform = ?,
                    app_version = ?,
                    active = 1,
                    updated_at = ?
                WHERE device_id = ?
                """,
                (
                    platform,
                    app_version,
                    now,
                    device_id,
                ),
            )

        connection.execute(
            "COMMIT"
        )

        return {
            "address": (
                f"{ipv4}/32, "
                f"{ipv6}/128"
            ),
            "dns":
                config["dns"],
            "server_public_key":
                config[
                    "server_public_key"
                ],
            "endpoint":
                config["endpoint"],
            "allowed_ips":
                config["allowed_ips"],
            "persistent_keepalive":
                config[
                    "persistent_keepalive"
                ],
        }

    except Exception:
        try:
            connection.execute(
                "ROLLBACK"
            )
        except Exception:
            pass

        if wg_applied:
            if (
                new_peer
                or existing_active == 0
            ):
                remove_peer_best_effort(
                    config["interface"],
                    public_key,
                )

            elif existing is not None:
                try:
                    configure_peer(
                        config["interface"],
                        str(
                            existing[
                                "public_key"
                            ]
                        ),
                        str(
                            existing["ipv4"]
                        ),
                        str(
                            existing["ipv6"]
                        ),
                    )
                except Exception:
                    pass

        raise

    finally:
        connection.close()


class ControlServer(
    http.server.ThreadingHTTPServer
):
    daemon_threads = True
    allow_reuse_address = True


class Handler(
    http.server.BaseHTTPRequestHandler
):
    server_version = (
        "PrivastreamTunnelControl/1"
    )

    sys_version = ""

    def log_message(
        self,
        fmt,
        *args,
    ):
        sys.stderr.write(
            "%s - %s\n"
            % (
                self.address_string(),
                fmt % args,
            )
        )

    def send_json(
        self,
        status,
        payload,
    ):
        body = json.dumps(
            payload,
            separators=(",", ":"),
        ).encode("utf-8")

        self.send_response(
            status
        )

        self.send_header(
            "Content-Type",
            "application/json"
        )

        self.send_header(
            "Content-Length",
            str(len(body))
        )

        self.send_header(
            "Cache-Control",
            "no-store"
        )

        self.end_headers()

        self.wfile.write(
            body
        )

    def do_GET(self):
        self.send_json(
            404,
            {
                "detail":
                    "not found"
            },
        )

    def do_POST(self):
        try:
            self.handle_post()

        except RequestError as exc:
            self.send_json(
                exc.status,
                {
                    "detail":
                        exc.message
                },
            )

        except Exception as exc:
            sys.stderr.write(
                "request failed: %s\n"
                % type(exc).__name__
            )

            self.send_json(
                500,
                {
                    "detail":
                        "control service error"
                },
            )

    def handle_post(self):
        parsed = urllib.parse.urlsplit(
            self.path
        )

        if parsed.path not in (
            "/v1/peers/provision",
            "/v1/peers/revoke",
        ):
            raise RequestError(
                404,
                "not found",
            )

        authorization = (
            self.headers.get(
                "Authorization",
                "",
            )
        )

        prefix = "Bearer "

        if not authorization.startswith(
            prefix
        ):
            raise RequestError(
                401,
                "unauthorized",
            )

        supplied_token = authorization[
            len(prefix):
        ].strip()

        if not hmac.compare_digest(
            supplied_token,
            self.server.config["token"],
        ):
            raise RequestError(
                401,
                "unauthorized",
            )

        content_type = (
            self.headers.get(
                "Content-Type",
                "",
            )
            .split(
                ";",
                1,
            )[0]
            .strip()
            .lower()
        )

        if content_type != "application/json":
            raise RequestError(
                415,
                "application/json required",
            )

        try:
            content_length = int(
                self.headers.get(
                    "Content-Length",
                    "0",
                )
            )
        except ValueError:
            raise RequestError(
                400,
                "invalid content length",
            )

        if (
            content_length <= 0
            or content_length > MAX_BODY
        ):
            raise RequestError(
                413,
                "invalid request size",
            )

        try:
            payload = json.loads(
                self.rfile.read(
                    content_length
                )
            )
        except Exception:
            raise RequestError(
                400,
                "invalid JSON",
            )

        if not isinstance(
            payload,
            dict,
        ):
            raise RequestError(
                400,
                "invalid request",
            )

        if (
            parsed.path
            == "/v1/peers/provision"
        ):
            try:
                user_id = validate_user_id(
                    payload.get(
                        "user_id"
                    )
                )

                device_id = (
                    validate_device_id(
                        payload.get(
                            "device_id"
                        )
                    )
                )

                public_key = (
                    validate_public_key(
                        payload.get(
                            "public_key"
                        )
                    )
                )

                platform = optional_text(
                    payload.get(
                        "platform"
                    ),
                    64,
                )

                app_version = optional_text(
                    payload.get(
                        "app_version"
                    ),
                    64,
                )

            except ValueError:
                raise RequestError(
                    400,
                    "invalid provisioning request",
                )

            response = provision_peer(
                self.server.config,
                user_id,
                device_id,
                public_key,
                platform,
                app_version,
            )

        else:
            try:
                user_id = validate_user_id(
                    payload.get(
                        "user_id"
                    )
                )

                device_id = (
                    validate_device_id(
                        payload.get(
                            "device_id"
                        )
                    )
                )

            except ValueError:
                raise RequestError(
                    400,
                    "invalid revocation request",
                )

            response = revoke_peer(
                self.server.config,
                user_id,
                device_id,
            )

        self.send_json(
            200,
            response,
        )


def self_test():
    validate_public_key(
        EXPECTED_SERVER_PUBLIC_KEY
    )

    test_uuid = (
        "12345678-1234-4234-"
        "8234-123456789abc"
    )

    if (
        validate_device_id(
            test_uuid
        )
        != test_uuid
    ):
        raise RuntimeError(
            "UUID validation failed"
        )

    if (
        slot_to_ipv4(
            257
        )
        != "10.197.1.1"
    ):
        raise RuntimeError(
            "IPv4 lower bound failed"
        )

    if (
        slot_to_ipv4(
            65534
        )
        != "10.197.255.254"
    ):
        raise RuntimeError(
            "IPv4 upper bound failed"
        )

    if (
        slot_to_ipv6(
            257
        )
        != "fd73:739:1::101"
    ):
        raise RuntimeError(
            "IPv6 lower bound failed"
        )

    if (
        slot_to_ipv6(
            65534
        )
        != "fd73:739:1::fffe"
    ):
        raise RuntimeError(
            "IPv6 upper bound failed"
        )

    print(
        "CONTROL_SELF_TEST=PASS"
    )


def check_dormant():
    config = load_config(
        require_dns=False
    )

    if config["dns"] != "":
        print(
            "CLIENT_DNS_CONFIGURED=YES"
        )
    else:
        print(
            "CLIENT_DNS_CONFIGURED=NO"
        )

    print(
        "DORMANT_CONFIG_CHECK=PASS"
    )


def serve():
    config = load_config(
        require_dns=True
    )

    init_db(
        config["db_path"]
    )

    result = reconcile_peers(
        config
    )

    print(
        "PEER_RECONCILIATION=PASS",
        flush=True,
    )

    print(
        "RECONCILED_ACTIVE_PEERS="
        + str(
            result["active"]
        ),
        flush=True,
    )

    print(
        "RECONCILED_REMOVED_PEERS="
        + str(
            result["removed"]
        ),
        flush=True,
    )

    server = ControlServer(
        (
            config["bind"],
            config["port"],
        ),
        Handler,
    )

    server.config = config

    server.serve_forever(
        poll_interval=0.5
    )


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "command",
        choices=(
            "self-test",
            "init-db",
            "check-dormant",
            "reconcile",
            "serve",
        ),
    )

    args = parser.parse_args()

    if args.command == "self-test":
        self_test()
        return

    if args.command == "init-db":
        init_db(
            DEFAULT_DB
        )

        print(
            "DATABASE_INIT=PASS"
        )

        return

    if args.command == "check-dormant":
        check_dormant()
        return

    if args.command == "reconcile":
        config = load_config(
            require_dns=True
        )

        init_db(
            config["db_path"]
        )

        result = reconcile_peers(
            config
        )

        print(
            "PEER_RECONCILIATION=PASS"
        )

        print(
            "RECONCILED_ACTIVE_PEERS="
            + str(
                result["active"]
            )
        )

        print(
            "RECONCILED_REMOVED_PEERS="
            + str(
                result["removed"]
            )
        )

        return

    if args.command == "serve":
        serve()
        return


if __name__ == "__main__":
    main()
