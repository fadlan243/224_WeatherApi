require("dotenv").config();

const express = require("express");
const axios = require("axios");
const path = require("path");

const app = express();
const PORT = 3000;

app.use(express.static(path.join(__dirname, "public")));

const baseUrl = process.env.MAPTILER_BASE_URL; // https://api.maptiler.com/geocoding
const apiKey = process.env.MAPTILER_API_KEY;
const mapStyle = process.env.MAPTILER_MAP_STYLE || "streets-v2";

// Tipe wilayah MapTiler yang dianggap setara "kecamatan" (urut prioritas).
// Cek "detail" pada respons kalau hasilnya belum sesuai, lalu sesuaikan daftar ini.
const TIPE_KECAMATAN = ["municipal_district", "joint_submunicipality"];

async function cariLokasi(q) {
    const { data } = await axios.get(`${baseUrl}/${encodeURIComponent(q)}.json`, {
        params: { key: apiKey, language: "id", limit: 1 },
    });
    return data.features[0];
}

// Reverse geocoding: satu fitur untuk setiap tingkat wilayah di titik tersebut
async function cariWilayahDiTitik(lon, lat) {
    const { data } = await axios.get(`${baseUrl}/${lon},${lat}.json`, {
        params: { key: apiKey, language: "id" },
    });
    const wilayah = {};
    for (const f of data.features) {
        const tipe = (f.place_type || [])[0];
        if (tipe && !wilayah[tipe]) wilayah[tipe] = f.text;
    }
    const namaLengkap = data.features[0] ? data.features[0].place_name : null;
    return { wilayah, namaLengkap };
}

// Susun hasil akhir dari sebuah titik koordinat.
// namaCari: nama hasil pencarian (kalau ada), agar kota tidak dianggap kecamatan.
async function bangunHasil(lon, lat, namaCari = "", namaLokasi = null) {
    const { wilayah, namaLengkap } = await cariWilayahDiTitik(lon, lat);

    let kecamatan = "-";
    for (const tipe of TIPE_KECAMATAN) {
        const nama = wilayah[tipe];
        if (nama && nama.toLowerCase() !== namaCari.toLowerCase()) {
            kecamatan = nama;
            break;
        }
    }

    return {
        lokasi: namaLokasi || namaLengkap || "Tidak ada nama tempat",
        negara: wilayah.country || "-",
        provinsi: wilayah.region || "-",
        kecamatan,
        longitude: lon,
        latitude: lat,
        detail: wilayah,
    };
}

// Cari berdasarkan nama tempat
app.get("/api/lokasi", async (req, res) => {
    const q = (req.query.q || "").trim();
    if (!q) return res.status(400).json({ message: "Lokasi tidak boleh kosong" });

    try {
        const feature = await cariLokasi(q);
        if (!feature) {
            return res.status(404).json({ message: `Lokasi "${q}" tidak ditemukan` });
        }
        const [lon, lat] = feature.geometry.coordinates;
        res.json(await bangunHasil(lon, lat, feature.text, feature.place_name));
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ message: "Gagal mengambil data dari MapTiler" });
    }
});

// Cari berdasarkan titik koordinat (klik di peta atau input manual)
app.get("/api/koordinat", async (req, res) => {
    const lon = Number(req.query.lon);
    const lat = Number(req.query.lat);

    if (!Number.isFinite(lon) || !Number.isFinite(lat) ||
        lon < -180 || lon > 180 || lat < -90 || lat > 90) {
        return res.status(400).json({ message: "Koordinat tidak valid (longitude -180..180, latitude -90..90)" });
    }

    try {
        res.json(await bangunHasil(lon, lat));
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ message: "Gagal mengambil data dari MapTiler" });
    }
});

// Proxy tile peta, supaya API key tetap tersimpan di server
app.get("/tiles/:z/:x/:y.png", async (req, res) => {
    const { z, x, y } = req.params;
    if (![z, x, y].every((n) => /^\d+$/.test(n))) return res.sendStatus(400);

    try {
        const url = `https://api.maptiler.com/maps/${mapStyle}/256/${z}/${x}/${y}.png`;
        const response = await axios.get(url, {
            params: { key: apiKey },
            responseType: "stream",
        });
        res.set("Content-Type", "image/png");
        res.set("Cache-Control", "public, max-age=86400");
        response.data.pipe(res);
    } catch (error) {
        console.error("Tile gagal:", error.message);
        res.sendStatus(502);
    }
});

app.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
});