// ==========================================
// API通信
// ==========================================

const API = {
    async get(type) {
        try {
            const response = await fetch(`./api/data.php?type=${type}`);
            const result = await response.json();
            if (result.success) {
                return result.data;
            }
            throw new Error(result.error || 'データ取得に失敗しました');
        } catch (error) {
            console.error('API Error:', error);
            throw error;
        }
    },

    async getAll() {
        return this.get('all');
    }
};

// ==========================================
// グローバルデータ
// ==========================================

let countries = [];
let services = [];
let rates = [];
let carrierZones = [];
let settings = {};
let boxes = [];
let selectedCountry = null;

// carrier:country_code -> zone
let carrierZoneMap = new Map();

// ==========================================
// 通知（Toastは使わない）
// ==========================================

function notify(message, level = 'info') {
    // 画面通知（Toast）は一切出さない。必要なら console にだけ残す。
    if (!message) return;
    if (level === 'error') console.error(message);
    else if (level === 'warn') console.warn(message);
    else console.log(message);
}

// ==========================================
// データ読み込み
// ==========================================

async function loadAllData() {
    try {
        const data = await API.getAll();
        
        countries = data.countries;
        services = data.services;
        rates = data.rates;
        carrierZones = data.carrier_zones || [];
        settings = data.settings;
        boxes = data.boxes || [];

        // マッピングを高速化
        carrierZoneMap = new Map();
        carrierZones.forEach(row => {
            const carrier = String(row.carrier || '').trim().toLowerCase();
            const countryCode = String(row.country_code || '').trim().toUpperCase();
            const zone = String(row.zone ?? '').trim();
            if (!carrier || !countryCode || !zone) return;
            carrierZoneMap.set(`${carrier}:${countryCode}`, zone);
        });
        
        console.log('Data loaded:', { 
            countries: countries.length, 
            services: services.length, 
            rates: rates.length,
            carrier_zones: carrierZones.length
        });
        
        return true;
    } catch (error) {
        console.error('Failed to load data:', error);
        return false;
    }
}

// ==========================================
// 箱サイズガイド
// ==========================================

function escapeHtml(value) {
    const s = String(value ?? '');
    return s
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
}

function getMaxDim(box) {
    const l = Number(box?.length_cm) || 0;
    const w = Number(box?.width_cm) || 0;
    const h = Number(box?.height_cm) || 0;
    return Math.max(l, w, h);
}

function getNumberSetting(key, fallback) {
    const raw = settings ? settings[key] : undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
}

function getBoxGuideConfig() {
    // 物理サイズ(cm) → 表示サイズ(px) 変換設定
    const refCm = clamp(getNumberSetting('boxGuideRefCm', 60), 1, 100000);
    const refPx = clamp(getNumberSetting('boxGuideRefPx', 90), 1, 100000);
    const minPx = clamp(getNumberSetting('boxGuideMinPx', 50), 1, 100000);
    const maxPx = clamp(getNumberSetting('boxGuideMaxPx', 110), 1, 100000);
    const scalePct = clamp(getNumberSetting('boxGuideScalePct', 100), 50, 200);

    const minCube = Math.min(minPx, maxPx);
    const maxCube = Math.max(minPx, maxPx);

    return {
        refCm,
        refPx,
        minCube,
        maxCube,
        scale: scalePct / 100
    };
}

function renderBoxSizeGuide() {
    const container = document.getElementById('boxSizeGuide');
    if (!container) return;

    const rows = (boxes || [])
        .map(b => ({
            key: String(b?.key ?? '').trim().toLowerCase(),
            label: String(b?.label ?? '').trim(),
            length_cm: Number(b?.length_cm) || 0,
            width_cm: Number(b?.width_cm) || 0,
            height_cm: Number(b?.height_cm) || 0,
            comment: String(b?.comment ?? '').trim(),
            sort: Number.isFinite(Number(b?.sort)) ? parseInt(b.sort, 10) : 0
        }))
        .filter(b => b.key && b.label && b.length_cm > 0 && b.width_cm > 0 && b.height_cm > 0)
        .sort((a, b) => (a.sort - b.sort) || a.key.localeCompare(b.key));

    // 5件以上は左寄せ（それ未満は中央寄せ）
    container.classList.toggle('align-left', rows.length >= 5);

    if (rows.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding: 1.5rem; color: var(--text-light); font-size: 0.9rem;">箱サイズが未設定です（管理画面で設定してください）</div>';
        return;
    }

    const cfg = getBoxGuideConfig();

    container.innerHTML = rows.map(b => {
        const dimCm = getMaxDim(b);
        const baseCube = (dimCm / cfg.refCm) * cfg.refPx;
        const cube = Math.round(clamp(baseCube * cfg.scale, cfg.minCube, cfg.maxCube));
        const tape = clamp(Math.round(cube * 0.22), 10, 22);
        const dims = `${b.length_cm}×${b.width_cm}×${b.height_cm} cm`;

        return `
            <div class="size-box-item" style="--cube-size: ${cube}px; --tape-size: ${tape}px;">
                <div class="cube-wrapper" aria-hidden="true">
                    <div class="cube-box">
                        <div class="cube-face cube-front">
                            <div class="tape-front-v"></div>
                        </div>
                        <div class="cube-face cube-top">
                            <div class="tape-top-v"></div>
                            <div class="tape-top-h"></div>
                        </div>
                        <div class="cube-face cube-right"></div>
                    </div>
                </div>
                <span class="size-label">${escapeHtml(b.label)}</span>
                <span class="size-dimensions">${escapeHtml(dims)}</span>
                ${b.comment ? `<span class="size-comment">${escapeHtml(b.comment)}</span>` : ''}
            </div>
        `;
    }).join('');
}

// ==========================================
// UI更新
// ==========================================

function applySettings() {
    document.getElementById('siteTitle').textContent = settings.title || '国際送料見積もりツール';
    document.getElementById('siteSubtitle').textContent = settings.subtitle || '';
    
    const notes = settings.notes || '';
    document.getElementById('notesContent').innerHTML = notes.replace(/\|/g, '<br>');
    
    document.getElementById('footerText').textContent = settings.footer || '';
}

// ==========================================
// 国検索機能
// ==========================================

function initCountrySearch() {
    const input = document.getElementById('countryInput');
    const dropdown = document.getElementById('countryDropdown');

    input.addEventListener('focus', () => {
        showCountryDropdown(countries);
    });

    input.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        const filtered = countries.filter(c => 
            c.name.toLowerCase().includes(query) || 
            c.code.toLowerCase().includes(query)
        );
        showCountryDropdown(filtered);
    });

    input.addEventListener('blur', () => {
        setTimeout(() => {
            dropdown.classList.remove('active');
        }, 200);
    });
}

function showCountryDropdown(countryList) {
    const dropdown = document.getElementById('countryDropdown');
    
    if (countryList.length === 0) {
        dropdown.innerHTML = '<div class="country-option" style="color: var(--text-light);">該当する国がありません</div>';
    } else {
        dropdown.innerHTML = countryList.map(c => `
            <div class="country-option" data-code="${c.code}">
                ${c.name} (${c.code})
            </div>
        `).join('');
        
        dropdown.querySelectorAll('.country-option').forEach(option => {
            option.addEventListener('click', () => {
                const code = option.dataset.code;
                selectedCountry = countries.find(c => c.code === code);
                document.getElementById('countryInput').value = `${selectedCountry.name} (${selectedCountry.code})`;
                dropdown.classList.remove('active');
            });
        });
    }
    
    dropdown.classList.add('active');
}

// ==========================================
// 計算ロジック
// ==========================================

function calculateVolumeWeight(length, width, height) {
    const raw = (length * width * height) / 5000;
    // 容積重量は0.5kg刻みで切り上げ（例: 5.4 → 5.5）
    return roundUpToHalf(raw);
}

function findRate(serviceName, zone, weight) {
    const zoneStr = String(zone ?? '').trim();
    // 重量は「範囲指定不要」で、weight（上限）だけで最小の該当行を選ぶ
    // 例: weight=5.4 のとき weight=10 の行が選ばれる
    const candidates = rates
        .filter(r =>
            r.service === serviceName &&
            String(r.zone ?? '').trim() === zoneStr &&
            typeof r.weight === 'number' &&
            weight <= r.weight
        )
        .sort((a, b) => a.weight - b.weight);
    return candidates[0];
}

function normalizeCarrierKey(value) {
    const v = String(value ?? '').trim().toLowerCase();
    return v;
}

function getCarrierKeyFromService(service) {
    return normalizeCarrierKey(service?.carrier);
}

function getZoneForService(service, country) {
    const carrier = getCarrierKeyFromService(service);
    const countryCode = String(country?.code || '').trim().toUpperCase();
    const mapped = carrier && countryCode ? carrierZoneMap.get(`${carrier}:${countryCode}`) : undefined;
    if (mapped !== undefined) return mapped;
    return '';
}

function roundUpToHalf(value) {
    if (!isFinite(value) || value <= 0) return 0;
    return Math.ceil(value * 2) / 2;
}

function parseCountryCodes(value) {
    // "US,CA MX" -> ["US","CA","MX"]
    const raw = String(value ?? '').trim();
    if (!raw) return [];
    const parts = raw
        .split(/[,|\s]+/)
        .map(s => String(s || '').trim().toUpperCase())
        .filter(Boolean);
    return Array.from(new Set(parts));
}

function isTruthyFlag(value) {
    const v = String(value ?? '').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function isServiceAvailableForCountry(service, country) {
    const codes = parseCountryCodes(service?.country_codes);
    if (codes.length === 0) return true;
    const cc = String(country?.code || '').trim().toUpperCase();
    return codes.includes(cc);
}

function calculate() {
    if (!selectedCountry) {
        notify('仕向国を選択してください', 'warn');
        return;
    }

    const weight = parseFloat(document.getElementById('weightInput').value) || 0;
    const length = parseFloat(document.getElementById('lengthInput').value) || 0;
    const width = parseFloat(document.getElementById('widthInput').value) || 0;
    const height = parseFloat(document.getElementById('heightInput').value) || 0;

    if (weight <= 0) {
        notify('重量を入力してください', 'warn');
        return;
    }

    const volumeWeight = calculateVolumeWeight(length, width, height);
    const appliedWeight = Math.max(weight, volumeWeight);

    // 重量情報表示
    document.getElementById('weightInfo').style.display = 'block';
    document.getElementById('actualWeight').textContent = `${weight.toFixed(2)} kg`;
    document.getElementById('volumeWeight').textContent = `${volumeWeight.toFixed(2)} kg`;
    document.getElementById('appliedWeight').textContent = `${appliedWeight.toFixed(2)} kg`;

    // 結果計算
    const missingCarrier = [];
    const missingZone = [];
    services.forEach(service => {
        const carrier = getCarrierKeyFromService(service);
        if (!carrier) missingCarrier.push(service.name || service.id || '(unknown)');
        else {
            const zone = getZoneForService(service, selectedCountry);
            if (!zone) missingZone.push(`${carrier}:${String(selectedCountry?.code || '').trim().toUpperCase()}`);
        }
    });
    const uniqueMissingCarrier = Array.from(new Set(missingCarrier));
    const uniqueMissingZone = Array.from(new Set(missingZone));
    if (uniqueMissingCarrier.length || uniqueMissingZone.length) {
        const msgParts = [];
        if (uniqueMissingCarrier.length) msgParts.push(`carrier未設定のサービス: ${uniqueMissingCarrier.join(', ')}`);
        if (uniqueMissingZone.length) msgParts.push(`carrier_zones未設定: ${uniqueMissingZone.join(', ')}`);
        // UIの結果カード側で「未設定」を表示しているため、ここでは画面通知はしない
        notify(msgParts.join(' / '), 'warn');
    }

    const items = services.map((service, idx) => {
        const carrier = getCarrierKeyFromService(service);
        const zone = getZoneForService(service, selectedCountry);
        const carrierClass = getCarrierClass(service);
        const available = isServiceAvailableForCountry(service, selectedCountry);
        const useActualWeight = isTruthyFlag(service?.use_actual_weight);
        const appliedWeightForService = useActualWeight ? weight : appliedWeight;

        if (!carrier) {
            return { idx, hasPrice: false, price: null, html: `
                <div class="result-card ${carrierClass}">
                    <div class="carrier-logo" style="background: ${service.color}">${service.name.split(' ')[0]}</div>
                    <div class="result-info">
                        <h3>${service.name}</h3>
                        <p>${service.description}</p>
                    </div>
                    <div class="result-price">
                        <div class="no-service">キャリア未設定</div>
                    </div>
                </div>
            ` };
        }

        if (!available) {
            return { idx, hasPrice: false, price: null, html: `
                <div class="result-card ${carrierClass}">
                    <div class="carrier-logo" style="background: ${service.color}">${service.name.split(' ')[0]}</div>
                    <div class="result-info">
                        <h3>${service.name}</h3>
                        <p>${service.description}</p>
                    </div>
                    <div class="result-price">
                        <div class="no-service">取扱なし</div>
                    </div>
                </div>
            ` };
        }

        if (!zone) {
            return { idx, hasPrice: false, price: null, html: `
                <div class="result-card ${carrierClass}">
                    <div class="carrier-logo" style="background: ${service.color}">${service.name.split(' ')[0]}</div>
                    <div class="result-info">
                        <h3>${service.name}</h3>
                        <p>${service.description}</p>
                    </div>
                    <div class="result-price">
                        <div class="no-service">ゾーン未設定（carrier_zones）</div>
                    </div>
                </div>
            ` };
        }

        const rate = findRate(service.name, zone, appliedWeightForService);
        
        if (rate) {
            return { idx, hasPrice: true, price: rate.price, html: `
                <div class="result-card ${carrierClass}">
                    <div class="carrier-logo" style="background: ${service.color}">${service.name.split(' ')[0]}</div>
                    <div class="result-info">
                        <h3>${service.name}</h3>
                        <p>${service.description}${useActualWeight ? '（実重量計算）' : ''}</p>
                    </div>
                    <div class="result-price">
                        <div class="price-value">¥${rate.price.toLocaleString()}</div>
                        <div class="price-unit">燃油込</div>
                    </div>
                </div>
            ` };
        } else {
            return { idx, hasPrice: false, price: null, html: `
                <div class="result-card ${carrierClass}">
                    <div class="carrier-logo" style="background: ${service.color}">${service.name.split(' ')[0]}</div>
                    <div class="result-info">
                        <h3>${service.name}</h3>
                        <p>${service.description}</p>
                    </div>
                    <div class="result-price">
                        <div class="no-service">取扱なし</div>
                    </div>
                </div>
            ` };
        }
    });

    // 価格が出るものを上に、価格の安い順に並べる（価格なしは後ろ）
    items.sort((a, b) => {
        if (a.hasPrice && b.hasPrice) {
            return (a.price - b.price) || (a.idx - b.idx);
        }
        if (a.hasPrice) return -1;
        if (b.hasPrice) return 1;
        return a.idx - b.idx;
    });

    const resultsHtml = items.map(x => x.html).join('');

    document.getElementById('resultsGrid').innerHTML = resultsHtml;
    document.getElementById('noResults').style.display = 'none';
    document.getElementById('resultsSection').classList.add('visible');
}

function getCarrierClass(service) {
    // CSSクラスは carrier と同じキーを期待
    return getCarrierKeyFromService(service) || '';
}

// ==========================================
// 初期化
// ==========================================

async function init() {
    // ローディング表示
    document.getElementById('noResults').innerHTML = `
        <div style="padding: 2rem;">
            <div class="loading-spinner"></div>
            <p style="margin-top: 1rem;">データを読み込み中...</p>
        </div>
    `;
    
    // データ読み込み
    const success = await loadAllData();
    
    if (success) {
        // 設定適用
        applySettings();

        // 箱サイズガイド表示
        renderBoxSizeGuide();
        
        // イベントリスナー設定
        document.getElementById('calculateBtn').addEventListener('click', calculate);
        
        // 国検索初期化
        initCountrySearch();
        
        // 初期表示に戻す
        document.getElementById('noResults').innerHTML = `
            <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="margin: 0 auto 1rem; opacity: 0.5;">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
            </svg>
            <p>配送情報を入力して<br>「送料を計算する」をクリックしてください</p>
        `;
        
        console.log('Application initialized successfully');
    } else {
        document.getElementById('noResults').innerHTML = `
            <div style="color: var(--error); padding: 2rem;">
                <p>データの読み込みに失敗しました</p>
                <p style="font-size: 0.8rem; margin-top: 0.5rem;">サーバー接続を確認してください</p>
            </div>
        `;
    }
}

// DOMContentLoaded時に初期化
document.addEventListener('DOMContentLoaded', init);
