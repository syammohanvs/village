"""The controller's address is DHCP, so the app has to be able to find it.

This deployment has seen the board at .8, .6 and .4; every move left the page
pointing at nothing until somebody edited `.env` and restarted the backend.
"""
from __future__ import annotations

import asyncio

import pytest

from app.device import candidate_hosts, discover_device


def test_candidates_put_the_configured_address_first():
    hosts = candidate_hosts("http://192.168.1.4")

    assert hosts[0] == "192.168.1.4"
    assert len(hosts) == 254
    # Asked once, not twice: the configured address is not repeated in the sweep.
    assert hosts.count("192.168.1.4") == 1
    assert hosts[1] == "192.168.1.1"


def test_candidates_ignore_something_that_is_not_an_address():
    # A hostname or a malformed value is not a subnet to sweep.
    assert candidate_hosts("http://village.local") == []
    assert candidate_hosts("http://") == []
    assert candidate_hosts("http://999.1.1.1") == []


def run(coro):
    return asyncio.run(coro)


def test_a_controller_at_the_configured_address_is_found_without_a_sweep():
    asked: list[str] = []

    async def prober(host: str) -> bool:
        asked.append(host)
        return host == "192.168.1.4"

    found = run(discover_device("http://192.168.1.4", "t", prober=prober))

    assert found == "http://192.168.1.4"
    assert asked == ["192.168.1.4"]


def test_a_controller_that_moved_is_found_and_reported_at_its_new_address():
    async def prober(host: str) -> bool:
        return host == "192.168.1.37"

    found = run(discover_device("http://192.168.1.4", "t", prober=prober))

    assert found == "http://192.168.1.37"


def test_a_network_with_no_controller_answers_nothing():
    async def prober(host: str) -> bool:
        return False

    assert run(discover_device("http://192.168.1.4", "t", prober=prober)) is None


def test_a_device_that_rejects_the_token_is_not_adopted():
    # Only a 200 counts: a printer or a Windows box on the same subnet must not
    # be mistaken for the village controller.
    async def prober(host: str) -> bool:
        return False

    assert run(discover_device("http://192.168.1.4", "t", prober=prober)) is None
