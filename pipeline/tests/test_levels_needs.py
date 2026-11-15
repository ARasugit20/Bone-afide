"""Tests for handling levels and needs, using the shipped config."""

from __future__ import annotations

from behavior.levels import assign_level
from behavior.needs import derive_needs
from behavior.schemas import ClipFeatures, Scores
from behavior.guardrails import HANDLING_LEVELS


def _s(energy=10, stress=10, approachability=90, confidence=80, arousal_spikes=0):
    return Scores(energy, stress, approachability, confidence, arousal_spikes)


# --- levels: the five demo dogs should land on expected bands ---

def test_demo_dog_levels():
    # (scores roughly matching the calibrated pipeline outputs)
    june = _s(energy=19, stress=8, approachability=97, confidence=100, arousal_spikes=5)
    katie = _s(energy=10, stress=10, approachability=95, confidence=96, arousal_spikes=0)
    kacy = _s(energy=0, stress=1, approachability=100, confidence=66, arousal_spikes=0)
    kinder = _s(energy=55, stress=45, approachability=100, confidence=100, arousal_spikes=1)
    luna = _s(energy=100, stress=49, approachability=99, confidence=100, arousal_spikes=7)

    assert assign_level(june) == "Green"
    assert assign_level(katie) == "Green"
    assert assign_level(kacy) == "Green"
    assert assign_level(kinder) == "Orange"
    assert assign_level(luna) in ("Yellow", "Orange")


def test_level_is_always_valid():
    for stress in range(0, 101, 10):
        lvl = assign_level(_s(stress=stress, arousal_spikes=stress // 10))
        assert lvl in HANDLING_LEVELS


def test_high_stress_spikes_low_approach_is_red():
    assert assign_level(_s(stress=85, arousal_spikes=9, approachability=20)) == "Red"


# --- needs ---

def test_high_energy_gives_active_home():
    needs = derive_needs(_s(energy=80, approachability=90))
    assert "active home with daily exercise" in needs


def test_jumping_gives_excitable_need():
    feats = ClipFeatures(jumps_per_min=10.0)
    needs = derive_needs(_s(energy=55, approachability=100), feats)
    assert "owner comfortable with an excitable dog" in needs


def test_low_energy_high_approach_gives_apartment_need():
    needs = derive_needs(_s(energy=10, approachability=95))
    assert "great for apartments / first-time owners" in needs


def test_needs_count_between_1_and_4():
    needs = derive_needs(_s(energy=90, stress=70, approachability=30, confidence=20, arousal_spikes=10),
                         ClipFeatures(jumps_per_min=12.0))
    assert 1 <= len(needs) <= 4


def test_needs_fallback_when_nothing_matches():
    needs = derive_needs(_s(energy=45, stress=25, approachability=55, confidence=60))
    assert len(needs) >= 1
