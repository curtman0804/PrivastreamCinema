#!/usr/bin/env bash
set -Eeuo pipefail

PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

ENV_FILE="/etc/privastream-egress/egress.env"
STATE_DIR="/run/privastream-egress"
STATE_FILE="${STATE_DIR}/sysctl.state"

fail() {
    echo "ERROR: $1" >&2
    exit 1
}

[ -r "$ENV_FILE" ] ||
    fail "missing egress environment"

# shellcheck disable=SC1090
. "$ENV_FILE"

required_vars=(
    PRIVASTREAM_IF
    WAN_IF
    PRIVASTREAM_IPV4
    PRIVASTREAM_IPV6
    IPV4_CHAIN
    IPV4_NAT_CHAIN
    IPV6_CHAIN
    IPV6_NAT_CHAIN
)

for var in "${required_vars[@]}"
do
    [ -n "${!var:-}" ] ||
        fail "missing ${var}"
done


iptables_chain_exists() {
    iptables -t "$1" -S "$2" >/dev/null 2>&1
}

ip6tables_chain_exists() {
    ip6tables -t "$1" -S "$2" >/dev/null 2>&1
}


remove_v4_rules() {
    while iptables \
        -t filter \
        -C FORWARD \
        -j "$IPV4_CHAIN" \
        >/dev/null 2>&1
    do
        iptables \
            -t filter \
            -D FORWARD \
            -j "$IPV4_CHAIN"
    done

    if iptables_chain_exists filter "$IPV4_CHAIN"
    then
        iptables \
            -t filter \
            -F "$IPV4_CHAIN"

        iptables \
            -t filter \
            -X "$IPV4_CHAIN"
    fi

    while iptables \
        -t nat \
        -C POSTROUTING \
        -j "$IPV4_NAT_CHAIN" \
        >/dev/null 2>&1
    do
        iptables \
            -t nat \
            -D POSTROUTING \
            -j "$IPV4_NAT_CHAIN"
    done

    if iptables_chain_exists nat "$IPV4_NAT_CHAIN"
    then
        iptables \
            -t nat \
            -F "$IPV4_NAT_CHAIN"

        iptables \
            -t nat \
            -X "$IPV4_NAT_CHAIN"
    fi
}


remove_v6_rules() {
    while ip6tables \
        -t filter \
        -C FORWARD \
        -j "$IPV6_CHAIN" \
        >/dev/null 2>&1
    do
        ip6tables \
            -t filter \
            -D FORWARD \
            -j "$IPV6_CHAIN"
    done

    if ip6tables_chain_exists filter "$IPV6_CHAIN"
    then
        ip6tables \
            -t filter \
            -F "$IPV6_CHAIN"

        ip6tables \
            -t filter \
            -X "$IPV6_CHAIN"
    fi

    while ip6tables \
        -t nat \
        -C POSTROUTING \
        -j "$IPV6_NAT_CHAIN" \
        >/dev/null 2>&1
    do
        ip6tables \
            -t nat \
            -D POSTROUTING \
            -j "$IPV6_NAT_CHAIN"
    done

    if ip6tables_chain_exists nat "$IPV6_NAT_CHAIN"
    then
        ip6tables \
            -t nat \
            -F "$IPV6_NAT_CHAIN"

        ip6tables \
            -t nat \
            -X "$IPV6_NAT_CHAIN"
    fi
}


save_forwarding_state() {
    install \
        -d \
        -o root \
        -g root \
        -m 0700 \
        "$STATE_DIR"

    {
        printf 'IPV6_ALL_OLD=%q\n' \
            "$(sysctl -n net.ipv6.conf.all.forwarding)"

        printf 'IPV6_DEFAULT_OLD=%q\n' \
            "$(sysctl -n net.ipv6.conf.default.forwarding)"

        printf 'IPV6_ETH0_OLD=%q\n' \
            "$(sysctl -n net.ipv6.conf.${WAN_IF}.forwarding)"
    } >"$STATE_FILE"

    chmod 0600 "$STATE_FILE"
}


enable_forwarding() {
    [ "$(sysctl -n net.ipv4.ip_forward)" = "1" ] ||
        fail "IPv4 forwarding must already equal 1"

    sysctl -q \
        -w \
        net.ipv6.conf.all.forwarding=1

    sysctl -q \
        -w \
        net.ipv6.conf.default.forwarding=1

    sysctl -q \
        -w \
        "net.ipv6.conf.${WAN_IF}.forwarding=1"

    if [ -e "/proc/sys/net/ipv6/conf/${PRIVASTREAM_IF}/forwarding" ]
    then
        sysctl -q \
            -w \
            "net.ipv6.conf.${PRIVASTREAM_IF}.forwarding=1"
    fi
}


restore_forwarding() {
    if [ -r "$STATE_FILE" ]
    then
        # shellcheck disable=SC1090
        . "$STATE_FILE"

        sysctl -q \
            -w \
            "net.ipv6.conf.${WAN_IF}.forwarding=${IPV6_ETH0_OLD}"

        sysctl -q \
            -w \
            "net.ipv6.conf.default.forwarding=${IPV6_DEFAULT_OLD}"

        sysctl -q \
            -w \
            "net.ipv6.conf.all.forwarding=${IPV6_ALL_OLD}"

        rm -f "$STATE_FILE"
    fi

    rmdir "$STATE_DIR" 2>/dev/null || true
}


apply_v4_rules() {
    remove_v4_rules

    iptables \
        -t filter \
        -N "$IPV4_CHAIN"

    iptables \
        -t filter \
        -A "$IPV4_CHAIN" \
        -i "$PRIVASTREAM_IF" \
        -o "$WAN_IF" \
        -s "$PRIVASTREAM_IPV4" \
        -j ACCEPT

    iptables \
        -t filter \
        -A "$IPV4_CHAIN" \
        -i "$WAN_IF" \
        -o "$PRIVASTREAM_IF" \
        -d "$PRIVASTREAM_IPV4" \
        -m conntrack \
        --ctstate RELATED,ESTABLISHED \
        -j ACCEPT

    iptables \
        -t filter \
        -I FORWARD 1 \
        -j "$IPV4_CHAIN"

    iptables \
        -t nat \
        -N "$IPV4_NAT_CHAIN"

    iptables \
        -t nat \
        -A "$IPV4_NAT_CHAIN" \
        -s "$PRIVASTREAM_IPV4" \
        -o "$WAN_IF" \
        -j MASQUERADE

    iptables \
        -t nat \
        -I POSTROUTING 1 \
        -j "$IPV4_NAT_CHAIN"
}


apply_v6_rules() {
    remove_v6_rules

    ip6tables \
        -t filter \
        -N "$IPV6_CHAIN"

    ip6tables \
        -t filter \
        -A "$IPV6_CHAIN" \
        -i "$PRIVASTREAM_IF" \
        -o "$WAN_IF" \
        -s "$PRIVASTREAM_IPV6" \
        -j ACCEPT

    ip6tables \
        -t filter \
        -A "$IPV6_CHAIN" \
        -i "$WAN_IF" \
        -o "$PRIVASTREAM_IF" \
        -d "$PRIVASTREAM_IPV6" \
        -m conntrack \
        --ctstate RELATED,ESTABLISHED \
        -j ACCEPT

    ip6tables \
        -t filter \
        -I FORWARD 1 \
        -j "$IPV6_CHAIN"

    ip6tables \
        -t nat \
        -N "$IPV6_NAT_CHAIN"

    ip6tables \
        -t nat \
        -A "$IPV6_NAT_CHAIN" \
        -s "$PRIVASTREAM_IPV6" \
        -o "$WAN_IF" \
        -j MASQUERADE

    ip6tables \
        -t nat \
        -I POSTROUTING 1 \
        -j "$IPV6_NAT_CHAIN"
}


check_live() {
    iptables \
        -t filter \
        -C FORWARD \
        -j "$IPV4_CHAIN"

    iptables \
        -t nat \
        -C POSTROUTING \
        -j "$IPV4_NAT_CHAIN"

    ip6tables \
        -t filter \
        -C FORWARD \
        -j "$IPV6_CHAIN"

    ip6tables \
        -t nat \
        -C POSTROUTING \
        -j "$IPV6_NAT_CHAIN"

    [ "$(sysctl -n net.ipv4.ip_forward)" = "1" ]

    [ "$(sysctl -n net.ipv6.conf.all.forwarding)" = "1" ]

    [ "$(sysctl -n net.ipv6.conf.default.forwarding)" = "1" ]

    [ "$(sysctl -n net.ipv6.conf.${WAN_IF}.forwarding)" = "1" ]

    echo "DIRECT_EGRESS_LIVE_CHECK=PASS"
}


check_dormant() {
    if iptables_chain_exists filter "$IPV4_CHAIN"
    then
        fail "IPv4 egress chain is live"
    fi

    if iptables_chain_exists nat "$IPV4_NAT_CHAIN"
    then
        fail "IPv4 NAT chain is live"
    fi

    if ip6tables_chain_exists filter "$IPV6_CHAIN"
    then
        fail "IPv6 egress chain is live"
    fi

    if ip6tables_chain_exists nat "$IPV6_NAT_CHAIN"
    then
        fail "IPv6 NAT chain is live"
    fi

    echo "DIRECT_EGRESS_RULES_LIVE=NO"
    echo "DIRECT_EGRESS_DORMANT_CHECK=PASS"
}


up() {
    if [ -e "$STATE_FILE" ]
    then
        fail "existing forwarding state file found"
    fi

    save_forwarding_state

    trap '
        remove_v6_rules || true
        remove_v4_rules || true
        restore_forwarding || true
    ' ERR

    apply_v4_rules
    apply_v6_rules

    enable_forwarding

    check_live

    trap - ERR
}


down() {
    # Restore forwarding first so IPv6 forwarding closes before rules vanish.
    restore_forwarding || true

    remove_v6_rules
    remove_v4_rules

    echo "DIRECT_EGRESS_DOWN=PASS"
}


case "${1:-}" in
    up)
        up
        ;;

    down)
        down
        ;;

    check-live)
        check_live
        ;;

    check-dormant)
        check_dormant
        ;;

    *)
        echo \
            "usage: $0 {up|down|check-live|check-dormant}" \
            >&2

        exit 64
        ;;
esac
