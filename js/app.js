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
let selectedCountry = null;

// carrier:country_code -> zone
let carrierZoneMap = new Map();

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

function getCarrierKeyFromServiceId(serviceId) {
    const id = String(serviceId || '').toLowerCase();
    if (id.includes('fedex')) return 'fedex';
    if (id.includes('dhl')) return 'dhl';
    if (id.includes('ups')) return 'ups';
    if (id.includes('ems')) return 'ems';
    return '';
}

function getZoneForService(service, country) {
    const carrier = getCarrierKeyFromServiceId(service.id);
    const countryCode = String(country?.code || '').trim().toUpperCase();
    const mapped = carrier && countryCode ? carrierZoneMap.get(`${carrier}:${countryCode}`) : undefined;
    if (mapped !== undefined) return mapped;
    // 互換: 既存の共通ゾーン（数値）を文字列として扱う
    return String(country?.zone ?? '').trim();
}

function roundUpToHalf(value) {
    if (!isFinite(value) || value <= 0) return 0;
    return Math.ceil(value * 2) / 2;
}

function calculate() {
    if (!selectedCountry) {
        showToast('仕向国を選択してください', 'error');
        return;
    }

    const weight = parseFloat(document.getElementById('weightInput').value) || 0;
    const length = parseFloat(document.getElementById('lengthInput').value) || 0;
    const width = parseFloat(document.getElementById('widthInput').value) || 0;
    const height = parseFloat(document.getElementById('heightInput').value) || 0;

    if (weight <= 0) {
        showToast('重量を入力してください', 'error');
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
    const resultsHtml = services.map(service => {
        const zone = getZoneForService(service, selectedCountry);
        const rate = findRate(service.name, zone, appliedWeight);
        const carrierClass = getCarrierClass(service.id);
        
        if (rate) {
            return `
                <div class="result-card ${carrierClass}">
                    <div class="carrier-logo" style="background: ${service.color}">${service.name.split(' ')[0]}</div>
                    <div class="result-info">
                        <h3>${service.name}</h3>
                        <p>${service.description}</p>
                    </div>
                    <div class="result-price">
                        <div class="price-value">¥${rate.price.toLocaleString()}</div>
                        <div class="price-unit">燃油込</div>
                    </div>
                </div>
            `;
        } else {
            return `
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
            `;
        }
    }).join('');

    document.getElementById('resultsGrid').innerHTML = resultsHtml;
    document.getElementById('noResults').style.display = 'none';
    document.getElementById('resultsSection').classList.add('visible');
}

function getCarrierClass(serviceId) {
    if (serviceId.includes('fedex')) return 'fedex';
    if (serviceId.includes('dhl')) return 'dhl';
    if (serviceId.includes('ups')) return 'ups';
    if (serviceId.includes('ems')) return 'ems';
    return '';
}

// ==========================================
// Toast通知
// ==========================================

function showToast(message, type = '') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast';
    if (type) toast.classList.add(type);
    toast.classList.add('visible');
    
    setTimeout(() => {
        toast.classList.remove('visible');
    }, 3000);
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
