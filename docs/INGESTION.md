# AdGym — Veri toplama (ingestion) rehberi

Bu doküman `scripts/ingest/` altındaki betiklerin nasıl çalıştığını, hangi kimlik bilgilerine
ihtiyaç duyduğunu, gerçek sınırlamaları ve verinin düzenli olarak nasıl yenileneceğini anlatır.

Tüm betikler **Node 22 ESM** ile yazıldı, yerleşik `fetch` kullanır, **hiç npm bağımlılığı yoktur**.

## Dosyalar

| Dosya | Görev |
|---|---|
| `data/brands.json` | Takip listesi (164 marka): `{ name, segment, market, vertical, metaPageId?, searchTerms?, tiktokHandle?, website? }` |
| `scripts/ingest/index.mjs` | Önce Meta, sonra TikTok'u çalıştırır, özet yazar. Token yoksa o kaynağı mesajla atlar (çıkış kodu 0). |
| `scripts/ingest/meta.mjs` | Meta Ad Library (Graph API `ads_archive`) → `data/ads/meta-tr.json`, `data/ads/meta-us.json` |
| `scripts/ingest/tiktok.mjs` | TikTok Commercial Content API + Creative Center dışa aktarımı + URL listesi → `data/ads/tiktok.json` |
| `scripts/ingest/normalize.mjs` | Ham API yanıtlarını SPEC'teki `Ad` tipine çevirir; birleştirme (merge/dedupe) yardımcıları |
| `scripts/ingest/score.mjs` | "Kazanan" skoru: `src/lib/score.ts` dosyasının birebir JS kopyası |
| `scripts/ingest/io.mjs` | Ortak yardımcılar: argüman ayrıştırma, atomik JSON yazma, HTTP |
| `data/ads/curated.json` | Elle seçilmiş, linki doğrulanmış klasik reklamlar (`source: "curated"`) |

## Komutlar

```bash
npm run ingest                      # = node scripts/ingest/index.mjs
npm run ingest:meta                 # = node scripts/ingest/meta.mjs
npm run ingest:tiktok               # = node scripts/ingest/tiktok.mjs

node scripts/ingest/index.mjs --dry-run          # hiçbir dosya yazmaz, sonucu stdout'a basar
node scripts/ingest/meta.mjs --market TR --brand "Mavi" --limit-per-brand 30 --verbose
node scripts/ingest/tiktok.mjs --import ./topads-tr.json --market TR
node scripts/ingest/tiktok.mjs --urls ./tiktok-urls.csv
```

`--dry-run` modunda loglar stderr'e, birleştirilmiş JSON stdout'a gider
(`node scripts/ingest/index.mjs --dry-run > preview.json`).

## Ortam değişkenleri

| Değişken | Zorunlu mu | Açıklama |
|---|---|---|
| `META_AD_LIBRARY_TOKEN` | Meta için evet | Ad Library API erişimi olan bir Meta kullanıcı erişim token'ı (tercihen 60 günlük uzun ömürlü) |
| `META_GRAPH_VERSION` | Hayır | Varsayılan `v21.0` |
| `TIKTOK_CLIENT_KEY` | TikTok CCA için evet | TikTok for Developers uygulamasının client key'i (Commercial Content API onaylı) |
| `TIKTOK_CLIENT_SECRET` | TikTok CCA için evet | Aynı uygulamanın client secret'ı |
| `TIKTOK_CCA_COUNTRY` | Hayır | Commercial Content API `country_code` filtresi. Varsayılan `ALL` (tüm AB/AEA). Örn. `DE`, `FR` |

Token'ları asla repoya yazmayın; yerelde `.env` yerine shell'de `export` edin, CI'da "secret" olarak saklayın.

---

## 1. Meta Ad Library

### Nasıl çalışır?
1. `data/brands.json` okunur. Her pazar için (`TR`, `US`) o pazara ait **ve** `GLOBAL` markalar sorgulanır.
2. Marka `metaPageId` içeriyorsa `search_page_ids` ile, yoksa `searchTerms` (ilk iki terim) ile
   `https://graph.facebook.com/v21.0/ads_archive` çağrılır:
   - `ad_reached_countries=["TR"]` veya `["US"]`, `ad_active_status=ACTIVE`, `ad_type=ALL`
   - alanlar: `id, ad_creation_time, ad_delivery_start_time, ad_delivery_stop_time, ad_creative_bodies, ad_creative_link_titles, ad_creative_link_captions, ad_creative_link_descriptions, ad_snapshot_url, page_id, page_name, publisher_platforms, languages`
   - `paging.next` takip edilir (marka başına varsayılan en fazla 50 reklam, `--limit-per-brand`).
3. `search_terms` reklam **metninde** arama yapar, reklamvereni filtrelemez. Bu yüzden sonuçlar sayfa adı
   markayla eşleşenlere indirgenir (`--no-filter` ile kapatılabilir). Güvenilir sonuç için `metaPageId` en iyisidir.
4. Aynı sayfa + aynı metin + aynı başlığa sahip reklamlar tek kayda indirilir; kopya sayısı `variations` olur
   (ölçekleme sinyali). Temsilci kayıt, en uzun süredir yayında olan reklamdır.
5. Skor hesaplanır, mevcut dosyayla **birleştirilir** ve atomik olarak (geçici dosya + rename) yazılır.

`metaPageId` yalnızca doğrulanmış markalarda var (Meta Ad Library aramasında sayfa adı birebir eşleşti):
Mavi `72193804754`, Koton `33709448234`, Penti `66031048413`, Etstur `110550738962380`.
Diğerleri `searchTerms` kullanır. Yeni bir ID eklerken facebook.com/ads/library'de markanın resmi sayfasını açıp
URL'deki `view_all_page_id=` değerini kopyalayın.

### Birleştirme kuralları (önemli)
`meta-tr.json` / `meta-us.json` elle ve başka ajanlarca da dolduruluyor. Bu yüzden betik dosyayı **asla ezmez**:
- Kayıtlar `id` ile tekilleştirilir. İki kayıt çakışırsa **daha zengin** olan (daha çok dolu alan, medya) esas alınır,
  boş alanlar diğerinden doldurulur.
- `media`, `body`, `cta`, `headline`, `landingUrl` alanlarında **dolu bir değer hiçbir zaman boş değerle ezilmez**
  (Graph API medya URL'si döndürmez; medya zenginleştirmesi ayrı bir süreçle `data/media/meta-media.json`'a yazılır,
  bu betik o dosyaya dokunmaz).
- Tazelik alanları (`isActive`, `endedAt`, `activeDays`, `variations`, `performance`, `collectedAt`) daha yeni toplanan kayıttan alınır.
- Hiç yeni veri gelmezse dosyaya dokunulmaz.

### Meta Ad Library token'ı nasıl alınır?
1. **Kimlik doğrulama:** facebook.com/ID adresinden kimliğinizi ve bulunduğunuz ülkeyi doğrulayın
   (Ad Library API için zorunlu; onay birkaç gün sürebilir).
2. **Geliştirici hesabı:** developers.facebook.com → "My Apps" → **Create App** (tip: *Business* veya *Other*).
3. **API koşulları:** facebook.com/ads/library/api adresinde "Get started" adımlarını tamamlayıp Ad Library API
   koşullarını kabul edin.
4. **Token üretimi:** developers.facebook.com/tools/explorer (Graph API Explorer) → uygulamanızı seçin →
   "Generate Access Token". Bu kısa ömürlü (~1–2 saat) bir kullanıcı token'ıdır.
5. **Uzun ömürlü token (60 gün):**
   ```bash
   curl -G "https://graph.facebook.com/v21.0/oauth/access_token" \
     -d grant_type=fb_exchange_token -d client_id=APP_ID \
     -d client_secret=APP_SECRET -d fb_exchange_token=KISA_OMURLU_TOKEN
   ```
6. Test: `META_AD_LIBRARY_TOKEN=... node scripts/ingest/meta.mjs --dry-run --market TR --brand Mavi --verbose`

### Dürüst sınırlama: TR/US ticari reklamlar
Resmi Ad Library API, **siyasi/sosyal konulu olmayan (ticari) reklamları yalnızca AB veya Birleşik Krallık'a
ulaşan reklamlar için** döndürür (AB Dijital Hizmetler Yasası şeffaflık kapsamı). `ad_reached_countries=["TR"]`
veya `["US"]` ile `ad_type=ALL` sorgusu bu yüzden genellikle **boş döner** ya da izin hatası verir;
ek erişim onayı olmayan uygulamalar için bu beklenen davranıştır.

Betik bunu zarifçe ele alır: yetki/izin hatası (Graph kodu 10, 100, 190, 200 vb.) ilk markada yakalanır,
Türkçe açıklama basılır, API gereksiz yere tekrar tekrar çağrılmaz ve mevcut veri korunur. 0 sonuç gelirse
de nedeni loglanır. Rate limit kodlarında (4, 17, 613...) 60 sn beklenip en fazla 2 kez yeniden denenir.

Pratikte TR/US ticari reklamlar için seçenekler:
- facebook.com/ads/library arayüzü (herkese açık, her ülke için ticari reklamları gösterir) üzerinden elle
  küratörlük — `meta-tr.json` / `meta-us.json` dosyaları şu an böyle dolduruluyor.
- Claude'un Meta Ads bağlayıcısındaki `ads_library_search` aracı: yalnızca `id, page_id, page_name,
  ad_creative_link_title, ad_creation_time, ad_delivery_start_time, ad_snapshot_url, currency` döndürür;
  medya, gövde metni ve platform bilgisi yoktur, en fazla 50 sonuç ve sayfalama yoktur. `normalize.mjs`
  içindeki `fromMetaArchive` bu şekli de (tekil `ad_creative_link_title`, unix saniye tarihleri) kabul eder.
- Meta'dan genişletilmiş Ad Library API erişimi talep etmek (araştırma/kurumsal başvuru).

---

## 2. TikTok

### Neler denendi, neler erişilebilir?

| Kaynak | Kapsam | Durum |
|---|---|---|
| **Creative Center "Top Ads"** (ads.tiktok.com/business/creativecenter/inspiration/topads) | TR, US ve diğer ülkeler; beğeni/CTR sıralaması | Web arayüzü herkese açık. Arkasındaki iç JSON uç noktası (`creative_radar_api/v1/top_ads/v2/list`) **istemci tarafında üretilen bir imza** (`user-sign`, `timestamp`, `anonymous-user-id` başlıkları) istiyor; imzasız istek `40101 no permission` döner. Bu imzayı tersine mühendislikle üretip otomatik kazımak bir erişim kontrolünü aşmak anlamına geldiği için **uygulanmadı**. Bunun yerine kullanıcının kendi tarayıcısından dışa aktardığı JSON'u içe alan `--import` modu var. |
| **TikTok Commercial Content API** (`open.tiktokapis.com/v2/research/adlib/ad/query/`) | Yalnızca **AB/AEA (+İsviçre, BK)** içinde gösterilen reklamlar | Uygulandı. Onaylı bir TikTok for Developers uygulaması (`TIKTOK_CLIENT_KEY/SECRET`) gerekiyor. TR/US kapsamı yok → kayıtlar `market: "GLOBAL"` yazılır. |
| **TikTok oEmbed** (`www.tiktok.com/oembed`) | Herkese açık tekil video/profil | Uygulandı (`--urls`). Video URL'sinin gerçekten var olduğunu doğrular, başlık/küçük resim/hesap bilgisini alır. Reklam metriklerini **vermez**. `brands.json`'daki `tiktokHandle` değerleri de bununla doğrulandı. |
| TikTok Ad Library web arayüzü (library.tiktok.com) | AB | Arayüz herkese açık; resmi programatik erişim = Commercial Content API. |

Sonuç: bu ortamda kimlik bilgisi olmadan **gerçek TikTok Top Ads verisi otomatik çekilemedi**, bu yüzden
`data/ads/tiktok.json` şu an `{ "generatedAt": ..., "ads": [] }`. Hiçbir reklam, ID veya URL uydurulmadı.

### A) Creative Center Top Ads (TR / US / global) — önerilen yol
1. Tarayıcınızda TikTok for Business hesabınızla giriş yapıp
   `https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en` sayfasını açın.
2. Filtreler: Bölge **Turkey** (veya United States), dönem **Son 30 gün**, sıralama **Beğeni** veya **CTR**,
   isterseniz sektör (ör. *E-commerce*, *Travel*).
3. Geliştirici araçları (F12) → **Network** → `top_ads/v2/list` isteğini bulun → yanıtı **Save as / Copy response**
   ile `topads-tr.json` olarak kaydedin (daha fazla sonuç için sayfayı aşağı kaydırıp sonraki sayfaları da kaydedin).
4. İçe aktarın:
   ```bash
   node scripts/ingest/tiktok.mjs --import topads-tr.json --market TR
   node scripts/ingest/tiktok.mjs --import topads-us-1.json,topads-us-2.json --market US
   node scripts/ingest/tiktok.mjs --import ./exports/global/ --market GLOBAL   # klasördeki tüm .json'lar
   ```
   Dosyadaki sıra = Top Ads sırası (`TikTok Top Ads #N` skora girer). `ctr` alanı 0–1 göreli değer olarak gelir,
   skora 0–100 yüzdelik olarak çevrilir. Video URL'leri (tiktokcdn) **süreli imzalıdır** ve birkaç gün içinde
   geçersizleşebilir; UI bu durumda metin kartına düşer, `libraryUrl` Creative Center detay sayfasını gösterir.
   Segment `brands.json` eşleşmesinden, yoksa başlıktaki otel/tatil kelimelerinden ve kampanya hedefinden çıkarılır.

TikTok Creative Center kullanım koşullarına uyun; dışa aktarılan veriyi yalnızca eğitim/ilham amaçlı kullanın.

### B) Commercial Content API (AB)
1. developers.tiktok.com → hesap oluşturun → **Manage apps → Connect an app**.
2. Ürün olarak **Commercial Content API**'yi ekleyin ve kullanım amacını anlatan başvuruyu gönderin (onay gerekir).
3. Onaydan sonra uygulama sayfasındaki **Client key** ve **Client secret** değerlerini alın.
4. Çalıştırın:
   ```bash
   export TIKTOK_CLIENT_KEY=... TIKTOK_CLIENT_SECRET=...
   node scripts/ingest/tiktok.mjs --dry-run --brand Gymshark --verbose
   node scripts/ingest/tiktok.mjs --country ALL --days 90
   ```
   Betik `client_credentials` ile token alır, her marka için `search_term=<marka adı>` ile sorgular,
   `search_id` ile sayfalar ve reklamvereni markayla eşleşen kayıtları tutar. `libraryUrl` =
   `https://library.tiktok.com/ads/detail/?ad_id=<id>`.

### C) URL listesi (oEmbed ile doğrulanmış)
`tiktok-urls.csv` (satır başına `url,market,segment,marka`, `#` yorum):
```
https://www.tiktok.com/@marka/video/7300000000000000000,TR,dtc,Mavi
```
```bash
node scripts/ingest/tiktok.mjs --urls tiktok-urls.csv
```
Yalnızca oEmbed'in doğruladığı URL'ler yazılır. Bu yol performans metriği içermez (skor taban değerde kalır),
bu yüzden sadece reklam olarak yayınlandığını bildiğiniz videoları ekleyin (ör. Creative Center'da gördükleriniz).

---

## 3. Küratörlü reklamlar (`data/ads/curated.json`)
27 klasik/yüksek performanslı reklam; hepsi **markanın resmi YouTube kanalında** yayınlanmış videolar.
Her kayıt üretim sırasında YouTube oEmbed ile doğrulandı ve yalnızca yükleyen kanal (`author_name`) markanın
kendi kanalıysa listeye alındı (ör. Dollar Shave Club, Squatty Potty, Poo~Pourri, Purple, Liquid Death,
Dr. Squatch, Manscaped, Old Spice, Volvo Trucks, Blendtec, Airbnb, Marriott, Turkish Airlines, Turkcell,
Hepsiburada). Üçüncü taraf yüklemeleri ve gömülmesi kapalı videolar elendi.
`libraryUrl` = YouTube video linki, `media` = YouTube küçük resmi (kalıcı `i.ytimg.com`).
Yayın tarihi doğrulanamadığı için `startedAt` boş bırakıldı; skor bu yüzden taban değer (10).

Yeni ekleme yaparken: yalnızca resmi kanaldaki videoyu kullanın ve
`https://www.youtube.com/oembed?format=json&url=<video-url>` yanıtındaki `author_name`'i kontrol edin.

---

## 4. Skor
`scripts/ingest/score.mjs`, `src/lib/score.ts`'in birebir kopyasıdır (kaynak `score.ts`):
taban 10 · süre ≥7g +5 / ≥30g +20 / ≥90g +35 / ≥180g +42 / ≥365g +48 · hâlâ yayında +12 ·
varyasyon ≥2 +6 / ≥5 +12 / ≥10 +18 · platform ≥2 +5 / ≥3 +8 ·
TikTok Top Ads sıra ≤10 +16 / ≤50 +12 / diğer +8, CTR yüzdeliği ≥80 +6, beğeni ≥100B +6. 0–100 arası kırpılır.
`score.ts` değişirse `score.mjs` de aynı şekilde güncellenmelidir.

---

## 5. Düzenli yenileme (GitHub Actions örneği)
Aşağıdaki dosyayı `.github/workflows/ingest.yml` olarak ekleyip `META_AD_LIBRARY_TOKEN`,
`TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` değerlerini repo **Settings → Secrets and variables → Actions**
altına girin. Token yoksa ilgili kaynak atlanır, iş başarısız olmaz.

```yaml
name: ingest-ads
on:
  schedule:
    - cron: "17 4 * * *"      # her gün 04:17 UTC (07:17 TR)
  workflow_dispatch: {}
permissions:
  contents: write
jobs:
  ingest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Ingest
        env:
          META_AD_LIBRARY_TOKEN: ${{ secrets.META_AD_LIBRARY_TOKEN }}
          TIKTOK_CLIENT_KEY: ${{ secrets.TIKTOK_CLIENT_KEY }}
          TIKTOK_CLIENT_SECRET: ${{ secrets.TIKTOK_CLIENT_SECRET }}
        run: node scripts/ingest/index.mjs
      - name: Commit data changes
        run: |
          git config user.name "adgym-bot"
          git config user.email "adgym-bot@users.noreply.github.com"
          git add data/ads/*.json
          git diff --cached --quiet || git commit -m "data: ads refresh $(date -u +%F)"
          git push
```
Uzun ömürlü Meta token'ı 60 günde bir dolar; takvime hatırlatıcı koyun veya bir System User token'ı kullanın.
Statik JSON değiştiğinde Vercel vb. bir platformda yeni build otomatik tetiklenir.

## 6. Sınırlamalar (özet)
- Meta: resmi API ile TR/US **ticari** reklamlar genelde gelmez (yalnızca AB/BK); medya URL'si hiçbir zaman gelmez.
  Harcama/gösterim verisi ticari reklamlarda yoktur. Skor yalnızca süre + ölçekleme sinyallerinden türetilir.
- TikTok: Creative Center'ın otomatik erişimi yok (imzalı iç API) → elle dışa aktarım + `--import`.
  Commercial Content API yalnızca AB kapsamlı ve onay ister. tiktokcdn medya URL'leri süreli.
- `search_terms` gürültülüdür; mümkün olduğunca `metaPageId` ekleyin.
