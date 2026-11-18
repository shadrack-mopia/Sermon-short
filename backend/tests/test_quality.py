from app.services import media


def test_hdr_detection():
    assert media.is_hdr("smpte2084")  # PQ / HDR10
    assert media.is_hdr("arib-std-b67")  # HLG (phones)
    assert not media.is_hdr("bt709")
    assert not media.is_hdr(None)


def test_quality_presets_increase_quality():
    def crf(q):
        a = media.encoder_args("libx264", q)
        return int(a[a.index("-crf") + 1])

    assert crf("standard") == 21
    assert crf("max") < crf("high") < crf("standard")  # lower CRF = higher quality
    assert media.audio_bitrate("max") == "256k" and media.audio_bitrate("standard") == "160k"
    assert crf("bogus") == 21  # unknown values fall back to standard
    nv = media.encoder_args("h264_nvenc", "high")
    assert nv[nv.index("-cq") + 1] == "20"


def test_tonemap_filter_outputs_sdr():
    f = media.tonemap_filter("arib-std-b67")
    assert "tonemap=tonemap=hable" in f and f.endswith("format=yuv420p") and "t=bt709" in f
