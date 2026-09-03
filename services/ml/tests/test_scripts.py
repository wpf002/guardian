from app.scripts import ScriptIndex, jaccard, load_index


def test_corpus_loads():
    index = load_index()
    assert len(index) >= 10


def test_identical_text_is_one():
    index = ScriptIndex()
    sig = index.signature("hello world this is a test string")
    assert jaccard(sig, sig) == 1.0


def test_matches_a_reworded_script():
    index = load_index()
    hit = index.query(
        "i have all of your friends and family list. if you dont send me the money "
        "i will send your pictures to everyone that you know. you have one hour",
        0.35,
    )
    assert hit is not None
    assert hit.id == "sx-001"


def test_ignores_ordinary_conversation():
    index = load_index()
    assert index.query("hey do you want to play the new update tonight with my brother", 0.35) is None


def test_matches_a_countdown_script():
    index = load_index()
    hit = index.query(
        "you have 30 minutes left. after that i start sending. dont ignore me. "
        "i will ruin your life and you cannot stop it",
        0.35,
    )
    assert hit is not None
    assert hit.id == "sx-011"


def test_signature_is_deterministic_across_processes():
    # The TypeScript index in apps/scorer uses the same permutation seeds and
    # shingle width, so a signature computed on either side must be identical.
    # scripts/parity.mjs prints the TypeScript value for this exact string.
    index = ScriptIndex()
    sig = index.signature("guardian parity check string")
    assert sig[:4] == [103659923, 5763064, 135647984, 68447835], sig[:4]
    assert len(sig) == 128
