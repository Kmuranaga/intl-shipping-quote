// ==========================================
// 管理画面 JavaScript
// ==========================================

const AdminAPI = {
    async auth(action, data = {}) {
        const response = await fetch('./api/auth.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, ...data })
        });
        return response.json();
    },

    async getData(type) {
        const response = await fetch(`./api/data.php?type=${type}`);
        return response.json();
    },

    async saveData(type, data) {
        const response = await fetch('./api/save.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, data })
        });
        return response.json();
    },

    async uploadCSV(type, file, extraFields = {}) {
        const formData = new FormData();
        formData.append('type', type);
        formData.append('csv', file);
        Object.entries(extraFields || {}).forEach(([k, v]) => {
            if (v !== undefined && v !== null && String(v).trim() !== '') {
                formData.append(k, String(v));
            }
        });
        
        const response = await fetch('./api/upload.php', {
            method: 'POST',
            body: formData
        });
        return response.json();
    }
};

// ==========================================
// 状態管理
// ==========================================

let isAuthenticated = false;
let currentTab = 'rates';
let editData = {
    rates: [],
    services: [],
    countries: [],
    carrier_zones: [],
    settings: {}
};

// Toastの自動消去タイマー
let toastTimerId = null;

// ==========================================
// services: carrier 正規化（carrier必須）
// ==========================================

function normalizeCarrierKey(value) {
    return String(value ?? '').trim().toLowerCase();
}

function normalizeCountryCodes(value) {
    // "US,CA MX" -> "US,CA,MX"（空は制限なし）
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const parts = raw
        .split(/[,|\s]+/)
        .map(s => String(s || '').trim().toUpperCase())
        .filter(Boolean);
    return Array.from(new Set(parts)).join(',');
}

function normalizeBoolFlag(value) {
    const v = String(value ?? '').trim().toLowerCase();
    return (v === '1' || v === 'true' || v === 'yes' || v === 'on') ? 1 : 0;
}

function normalizeServiceRow(service) {
    const s = service || {};
    const id = String(s.id ?? '').trim();
    const carrier = normalizeCarrierKey(s.carrier);
    return {
        id,
        name: String(s.name ?? '').trim(),
        carrier,
        color: String(s.color ?? '').trim(),
        description: String(s.description ?? '').trim(),
        country_codes: normalizeCountryCodes(s.country_codes),
        use_actual_weight: normalizeBoolFlag(s.use_actual_weight)
    };
}

function normalizeServicesInPlace() {
    editData.services = (editData.services || []).map(normalizeServiceRow);
}

// ==========================================
// 認証
// ==========================================

async function checkAuth() {
    try {
        const result = await AdminAPI.auth('check');
        if (result.success) {
            isAuthenticated = true;
            showAdminPanel();
            loadAllAdminData();
        } else {
            showLoginForm();
        }
    } catch (error) {
        showLoginForm();
    }
}

async function login() {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    
    if (!username || !password) {
        showToast('ユーザー名とパスワードを入力してください', 'error');
        return;
    }
    
    try {
        const result = await AdminAPI.auth('login', { username, password });
        if (result.success) {
            isAuthenticated = true;
            showAdminPanel();
            loadAllAdminData();
            showToast('ログインしました', 'success');
        } else {
            showToast(result.error || 'ログインに失敗しました', 'error');
        }
    } catch (error) {
        showToast('サーバーエラーが発生しました', 'error');
    }
}

async function logout() {
    try {
        await AdminAPI.auth('logout');
    } catch (error) {
        console.error('Logout error:', error);
    }
    isAuthenticated = false;
    showLoginForm();
    showToast('ログアウトしました', 'success');
}

function showLoginForm() {
    document.getElementById('loginSection').style.display = 'block';
    document.getElementById('adminSection').style.display = 'none';
}

function showAdminPanel() {
    document.getElementById('loginSection').style.display = 'none';
    document.getElementById('adminSection').style.display = 'block';
}

// ==========================================
// データ読み込み
// ==========================================

async function loadAllAdminData() {
    try {
        const [ratesRes, servicesRes, countriesRes, carrierZonesRes, settingsRes] = await Promise.all([
            AdminAPI.getData('rates'),
            AdminAPI.getData('services'),
            AdminAPI.getData('countries'),
            AdminAPI.getData('carrier_zones'),
            AdminAPI.getData('settings')
        ]);
        
        if (ratesRes.success) editData.rates = ratesRes.data;
        if (servicesRes.success) editData.services = servicesRes.data;
        if (countriesRes.success) editData.countries = countriesRes.data;
        if (carrierZonesRes.success) editData.carrier_zones = carrierZonesRes.data;
        if (settingsRes.success) editData.settings = settingsRes.data;

        // services は carrier 必須（小文字正規化のみ）
        normalizeServicesInPlace();
        
        renderCurrentTab();
    } catch (error) {
        showToast('データの読み込みに失敗しました', 'error');
    }
}

// ==========================================
// 共通保存ヘルパー
// ==========================================

async function saveDataWithMessage(type, data, successMessage) {
    try {
        const result = await AdminAPI.saveData(type, data);
        if (result.success) {
            showToast(successMessage, 'success');
        } else {
            showToast(result.error || '保存に失敗しました', 'error');
        }
    } catch (error) {
        showToast('サーバーエラーが発生しました', 'error');
    }
}

// ==========================================
// タブ切り替え
// ==========================================

function initTabs() {
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            currentTab = tab.dataset.tab;
            document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`tab-${currentTab}`).classList.add('active');
            renderCurrentTab();
        });
    });
}

function renderCurrentTab() {
    switch (currentTab) {
        case 'rates':
            renderRatesTable();
            break;
        case 'services':
            renderServicesList();
            break;
        case 'countries':
            renderCountriesTable();
            break;
        case 'carrier_zones':
            renderCarrierZonesTable();
            break;
        case 'settings':
            renderSettings();
            break;
    }
}

// ==========================================
// 運賃データ管理
// ==========================================

function renderRatesTable() {
    const tbody = document.getElementById('ratesTableBody');
    
    if (editData.rates.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 2rem;">データがありません</td></tr>';
        return;
    }
    
    // サービス・ゾーンでグループ化して表示
    const grouped = {};
    editData.rates.forEach(rate => {
        const key = `${rate.service}-${rate.zone}`;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(rate);
    });
    
    let html = '';
    let rowIndex = 0;
    editData.rates.forEach((rate, index) => {
        html += `
            <tr data-index="${index}">
                <td>${rate.service}</td>
                <td>${rate.zone}</td>
                <td>${rate.weight}</td>
                <td>¥${rate.price.toLocaleString()}</td>
                <td>
                    <button class="btn-icon btn-edit" onclick="editRate(${index})" title="編集">✏️</button>
                    <button class="btn-icon btn-delete" onclick="deleteRate(${index})" title="削除">🗑️</button>
                </td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html;
    document.getElementById('ratesCount').textContent = `${editData.rates.length}件`;
}

async function editRate(index) {
    const rate = editData.rates[index];
    const newPrice = prompt('新しい料金を入力:', rate.price);
    if (newPrice !== null && !isNaN(newPrice)) {
        editData.rates[index].price = parseInt(newPrice);
        renderRatesTable();
        await saveDataWithMessage('rates', editData.rates, '料金を変更しました');
    }
}

async function deleteRate(index) {
    if (confirm('この運賃データを削除しますか？')) {
        editData.rates.splice(index, 1);
        renderRatesTable();
        await saveDataWithMessage('rates', editData.rates, '削除しました');
    }
}

async function addRate() {
    const service = prompt('サービス（サービス管理で登録したサービス名）:');
    if (!service) return;
    
    const zone = prompt('ゾーン（carrier_zonesで登録したゾーン）:');
    if (zone === null) return;
    const zoneStr = String(zone).trim();
    if (!zoneStr) return;
    
    const weight = prompt('重量(kg):');
    if (weight === null || isNaN(weight)) return;
    
    const price = prompt('料金 (円):');
    if (!price || isNaN(price)) return;

    // クライアント側バリデーション（サーバ側でも必ず検証されます）
    const serviceName = String(service).trim();
    const serviceNames = new Set((editData.services || []).map(s => String(s?.name || '').trim()).filter(Boolean));
    if (!serviceNames.has(serviceName)) {
        showToast(`存在しないサービスです: ${serviceName}`, 'error');
        return;
    }

    // service.name -> carrier
    const serviceToCarrier = new Map((editData.services || [])
        .map(s => [String(s?.name || '').trim(), normalizeCarrierInput(s?.carrier)])
        .filter(([n, c]) => n && c));
    const carrier = serviceToCarrier.get(serviceName) || '';
    if (!carrier) {
        showToast(`サービスのキャリアが未設定です: ${serviceName}`, 'error');
        return;
    }

    const carrierZonesForCarrier = new Set((editData.carrier_zones || [])
        .filter(r => normalizeCarrierInput(r?.carrier) === carrier)
        .map(r => normalizeZoneInput(r?.zone))
        .filter(Boolean));
    if (!carrierZonesForCarrier.has(zoneStr)) {
        showToast(`存在しないゾーンです（キャリア別ゾーンに存在しない）: ${carrier}|${zoneStr}`, 'error');
        return;
    }

    const weightNorm = String(parseFloat(weight));
    const dupKey = `${serviceName}|${zoneStr}|${weightNorm}`;
    const existingKeys = new Set((editData.rates || []).map(r =>
        `${String(r?.service || '').trim()}|${String(r?.zone || '').trim()}|${String(parseFloat(r?.weight))}`
    ));
    if (existingKeys.has(dupKey)) {
        showToast(`service,zone,weight が同じ組み合わせが存在します: ${dupKey}`, 'error');
        return;
    }
    
    editData.rates.push({
        service: serviceName,
        zone: zoneStr,
        weight: parseFloat(weightNorm),
        price: parseInt(price)
    });
    
    renderRatesTable();
    await saveDataWithMessage('rates', editData.rates, '追加しました');
}

async function saveRates() {
    // クライアント側バリデーション（サーバ側でも必ず検証されます）
    const serviceNames = new Set((editData.services || []).map(s => String(s?.name || '').trim()).filter(Boolean));
    const serviceToCarrier = new Map((editData.services || [])
        .map(s => [String(s?.name || '').trim(), normalizeCarrierInput(s?.carrier)])
        .filter(([n, c]) => n && c));
    const carrierToZones = new Map();
    (editData.carrier_zones || []).forEach(r => {
        const c = normalizeCarrierInput(r?.carrier);
        const z = normalizeZoneInput(r?.zone);
        if (!c || !z) return;
        if (!carrierToZones.has(c)) carrierToZones.set(c, new Set());
        carrierToZones.get(c).add(z);
    });

    const dup = new Set();
    const missingServices = new Set();
    const missingZones = new Set();
    const seen = new Set();
    (editData.rates || []).forEach(r => {
        const s = String(r?.service || '').trim();
        const z = String(r?.zone || '').trim();
        const w = String(parseFloat(r?.weight));
        const key = `${s}|${z}|${w}`;
        if (seen.has(key)) dup.add(key);
        seen.add(key);
        if (s && !serviceNames.has(s)) missingServices.add(s);
        const carrier = serviceToCarrier.get(s) || '';
        const zones = carrier ? carrierToZones.get(carrier) : null;
        if (s && z && (!carrier || !zones || !zones.has(z))) missingZones.add(`${carrier}|${z}`);
    });

    if (dup.size) {
        showToast(`service,zone,weight が同じ組み合わせが存在します: ${Array.from(dup).join(', ')}`, 'error');
        return;
    }
    if (missingServices.size) {
        showToast(`存在しないサービスが含まれています: ${Array.from(missingServices).join(', ')}`, 'error');
        return;
    }
    if (missingZones.size) {
        showToast(`存在しないゾーンが含まれています（キャリア別ゾーンに存在しない）: ${Array.from(missingZones).join(', ')}`, 'error');
        return;
    }

    await saveDataWithMessage('rates', editData.rates, '運賃データを保存しました');
}

// ==========================================
// サービス管理
// ==========================================

function renderServicesList() {
    const container = document.getElementById('servicesList');
    
    if (editData.services.length === 0) {
        container.innerHTML = '<p style="text-align: center; padding: 2rem; color: var(--text-light);">サービスがありません</p>';
        return;
    }
    
    container.innerHTML = editData.services.map((service, index) => `
        <div class="service-item">
            <div class="service-item-info">
                <div class="service-color" style="background: ${service.color}"></div>
                <div>
                    <strong>
                        ${service.name}
                        ${service.country_codes ? `<span class="badge">適用国: ${service.country_codes}</span>` : ''}
                        ${service.use_actual_weight ? `<span class="badge">実重量計算</span>` : ''}
                    </strong>
                    <div style="font-size: 0.8rem; color: var(--text-light);">${service.description}</div>
                    <div style="font-size: 0.75rem; color: var(--text-light);">キャリア: ${service.carrier || '(未設定)'}</div>
                </div>
            </div>
            <div class="service-item-actions">
                <button class="btn-icon btn-edit" onclick="editService(${index})" title="編集">✏️</button>
                <button class="btn-icon btn-delete" onclick="deleteService(${index})" title="削除">🗑️</button>
            </div>
        </div>
    `).join('');
}

async function editService(index) {
    const service = editData.services[index];
    
    const name = prompt('サービス名:', service.name);
    if (name === null) return;
    
    const carrier = prompt('キャリアキー（例: fedex）:', service.carrier || '');
    if (carrier === null) return;
    if (!normalizeCarrierKey(carrier)) {
        showToast('キャリアキーは必須です', 'error');
        return;
    }
    
    const description = prompt('説明:', service.description);
    if (description === null) return;
    
    const color = prompt('色 (HEX):', service.color);
    if (color === null) return;

    const country_codes = prompt('適用国コード（カンマ区切り。空=制限なし）:', service.country_codes || '');
    if (country_codes === null) return;
    
    const useActual = confirm(
        `実重量で計算しますか？\nOK=ON / キャンセル=OFF\n（現在: ${service.use_actual_weight ? 'ON' : 'OFF'}）`
    );
    
    editData.services[index] = normalizeServiceRow({ ...service, name, carrier, description, color, country_codes, use_actual_weight: useActual ? 1 : 0 });
    renderServicesList();
    await saveDataWithMessage('services', editData.services, '変更しました');
}

async function deleteService(index) {
    if (confirm('このサービスを削除しますか？')) {
        editData.services.splice(index, 1);
        renderServicesList();
        await saveDataWithMessage('services', editData.services, '削除しました');
    }
}

async function addService() {
    const id = prompt('ID (英数字):');
    if (!id) return;
    
    const name = prompt('サービス名（サービス管理で登録したサービス名）:');
    if (!name) return;
    
    const carrier = prompt('キャリアキー（例: fedex）:');
    if (carrier === null) return;
    if (!normalizeCarrierKey(carrier)) {
        showToast('キャリアキーは必須です', 'error');
        return;
    }
    
    const description = prompt('説明:');
    if (description === null) return;
    
    const color = prompt('色 (HEX):', '#333333');
    if (!color) return;

    const country_codes = prompt('適用国コード（カンマ区切り。空=制限なし）:', '');
    if (country_codes === null) return;
    
    const useActual = confirm('実重量で計算しますか？\nOK=ON / キャンセル=OFF');
    
    editData.services.push(normalizeServiceRow({ id, name, carrier, description, color, country_codes, use_actual_weight: useActual ? 1 : 0 }));
    renderServicesList();
    await saveDataWithMessage('services', editData.services, '追加しました');
}

async function saveServices() {
    normalizeServicesInPlace();
    await saveDataWithMessage('services', editData.services, 'サービス情報を保存しました');
}

// ==========================================
// 国管理
// ==========================================

function renderCountriesTable() {
    const tbody = document.getElementById('countriesTableBody');
    
    if (editData.countries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 2rem;">データがありません</td></tr>';
        return;
    }
    
    tbody.innerHTML = editData.countries.map((country, index) => `
        <tr>
            <td>${country.name}</td>
            <td>${country.code}</td>
            <td>
                <button class="btn-icon btn-edit" onclick="editCountry(${index})" title="編集">✏️</button>
                <button class="btn-icon btn-delete" onclick="deleteCountry(${index})" title="削除">🗑️</button>
            </td>
        </tr>
    `).join('');
    
    document.getElementById('countriesCount').textContent = `${editData.countries.length}件`;
}

async function editCountry(index) {
    const country = editData.countries[index];
    
    const name = prompt('国名:', country.name);
    if (name === null) return;
    
    const code = prompt('国コード:', country.code);
    if (code === null) return;
    editData.countries[index] = { name, code };
    renderCountriesTable();
    await saveDataWithMessage('countries', editData.countries, '変更しました');
}

async function deleteCountry(index) {
    if (confirm('この国を削除しますか？')) {
        editData.countries.splice(index, 1);
        renderCountriesTable();
        await saveDataWithMessage('countries', editData.countries, '削除しました');
    }
}

async function addCountry() {
    const name = prompt('国名:');
    if (!name) return;
    
    const code = prompt('国コード (例: JP):');
    if (!code) return;
    editData.countries.push({ name, code });
    renderCountriesTable();
    await saveDataWithMessage('countries', editData.countries, '追加しました');
}

async function saveCountries() {
    await saveDataWithMessage('countries', editData.countries, '国情報を保存しました'); 
}

// ==========================================
// キャリア別ゾーン管理
// ==========================================

function normalizeCarrierInput(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeZoneInput(value) {
    return String(value || '').trim();
}

function renderCarrierZonesTable() {
    const tbody = document.getElementById('carrierZonesTableBody');
    const countEl = document.getElementById('carrierZonesCount');
    if (!tbody || !countEl) return;

    const carrierFilter = normalizeCarrierInput(document.getElementById('carrierZonesCarrierFilter')?.value);
    const zoneFilter = normalizeZoneInput(document.getElementById('carrierZonesZoneFilter')?.value);

    const filtered = (editData.carrier_zones || []).filter(row => {
        const c = normalizeCarrierInput(row.carrier);
        const z = normalizeZoneInput(row.zone);
        if (carrierFilter && c !== carrierFilter) return false;
        if (zoneFilter && z !== zoneFilter) return false;
        return true;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 2rem;">データがありません</td></tr>';
        countEl.textContent = '0件';
        updateCarrierZonesLookup();
        return;
    }

    tbody.innerHTML = filtered.map((row, index) => {
        // indexはfiltered上の位置なので、操作時は元配列のindexを再取得する
        const originalIndex = (editData.carrier_zones || []).findIndex(r =>
            normalizeCarrierInput(r.carrier) === normalizeCarrierInput(row.carrier) &&
            String(r.country_code || '').toUpperCase() === String(row.country_code || '').toUpperCase() &&
            normalizeZoneInput(r.zone) === normalizeZoneInput(row.zone)
        );

        return `
            <tr>
                <td>${row.carrier}</td>
                <td>${row.country_code}</td>
                <td>${row.zone}</td>
                <td>
                    <button class="btn-icon btn-edit" onclick="editCarrierZone(${originalIndex})" title="編集">✏️</button>
                    <button class="btn-icon btn-delete" onclick="deleteCarrierZone(${originalIndex})" title="削除">🗑️</button>
                </td>
            </tr>
        `;
    }).join('');

    countEl.textContent = `${filtered.length}件`;
    updateCarrierZonesLookup();
}

function buildCarrierZoneKey(carrier, countryCode) {
    const c = normalizeCarrierInput(carrier);
    const cc = String(countryCode || '').trim().toUpperCase();
    if (!c || !cc) return '';
    return `${c}|${cc}`;
}

function getServiceCarriers() {
    const carriers = new Set();
    (editData.services || []).forEach(s => {
        const c = normalizeCarrierKey(s?.carrier);
        if (c) carriers.add(c);
    });
    return Array.from(carriers).sort();
}

function getCountryCodes() {
    const codes = new Set();
    (editData.countries || []).forEach(c => {
        const code = String(c?.code || '').trim().toUpperCase();
        if (code) codes.add(code);
    });
    return Array.from(codes).sort();
}

function validateCarrierZonesClient(rows, { allowExisting = true } = {}) {
    const validCarriers = new Set(getServiceCarriers().map(normalizeCarrierInput));
    const validCountryCodes = new Set(getCountryCodes().map(cc => String(cc).toUpperCase()));

    const seen = new Set();
    const duplicates = new Set();
    const missingCarriers = new Set();
    const missingCountries = new Set();

    (rows || []).forEach(r => {
        const carrier = normalizeCarrierInput(r?.carrier);
        const countryCode = String(r?.country_code || '').trim().toUpperCase();
        if (!carrier || !countryCode) return; // 必須チェックは別でやる

        const key = `${carrier}|${countryCode}`;
        if (seen.has(key)) duplicates.add(key);
        seen.add(key);

        if (allowExisting) {
            const existingKeys = new Set((editData.carrier_zones || [])
                .map(x => buildCarrierZoneKey(x?.carrier, x?.country_code))
                .filter(Boolean));
            if (existingKeys.has(key)) duplicates.add(key);
        }

        if (!validCarriers.has(carrier)) missingCarriers.add(carrier);
        if (!validCountryCodes.has(countryCode)) missingCountries.add(countryCode);
    });

    if (duplicates.size) {
        return { ok: false, error: `carrier,country_code が同じ組み合わせが存在します: ${Array.from(duplicates).join(', ')}` };
    }
    if (missingCountries.size) {
        return { ok: false, error: `存在しない国コードが含まれています: ${Array.from(missingCountries).join(', ')}` };
    }
    if (missingCarriers.size) {
        return { ok: false, error: `存在しないキャリアが含まれています: ${Array.from(missingCarriers).join(', ')}` };
    }
    return { ok: true, error: null };
}

function getExistingCarrierZoneKeySet() {
    const set = new Set();
    (editData.carrier_zones || []).forEach(r => {
        const key = buildCarrierZoneKey(r?.carrier, r?.country_code);
        const zone = normalizeZoneInput(r?.zone);
        // zone が空は「未設定」として不足扱いにする
        if (key && zone) set.add(key);
    });
    return set;
}

function computeMissingCarrierZones() {
    const carriers = getServiceCarriers();
    const countryCodes = getCountryCodes();
    const existing = getExistingCarrierZoneKeySet();

    const missing = [];
    carriers.forEach(carrier => {
        countryCodes.forEach(cc => {
            const key = buildCarrierZoneKey(carrier, cc);
            if (!key) return;
            if (!existing.has(key)) missing.push({ carrier, country_code: cc });
        });
    });
    return missing;
}

function updateCarrierZonesLookup() {
    const input = document.getElementById('carrierZonesLookup');
    const out = document.getElementById('carrierZonesLookupResult');
    if (!input || !out) return;

    const raw = String(input.value || '').trim();
    if (!raw) {
        out.textContent = '';
        return;
    }

    // 形式: "fedex E" または "dhl 5"
    const parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length < 2) {
        out.textContent = '入力例: "fedex E" / "dhl 5"';
        return;
    }

    const carrier = normalizeCarrierInput(parts[0]);
    const zone = normalizeZoneInput(parts.slice(1).join(' '));

    const matches = (editData.carrier_zones || [])
        .filter(r => normalizeCarrierInput(r.carrier) === carrier && normalizeZoneInput(r.zone) === zone)
        .map(r => String(r.country_code || '').toUpperCase())
        .filter(Boolean);

    const unique = Array.from(new Set(matches)).sort();
    out.textContent = unique.length
        ? `該当国コード: ${unique.join(', ')}`
        : '該当なし';
}

async function addCarrierZone() {
    const carrier = normalizeCarrierInput(prompt('キャリア (例: fedex / dhl):'));
    if (!carrier) return;

    const country_code = String(prompt('国コード (例: US):') || '').trim().toUpperCase();
    if (!country_code) return;

    const zone = normalizeZoneInput(prompt('ゾーン (例: E / 1):'));
    if (!zone) return;

    // クライアント側バリデーション（サーバ側でも必ず検証されます）
    const v = validateCarrierZonesClient([{ carrier, country_code, zone }], { allowExisting: true });
    if (!v.ok) {
        showToast(v.error || 'バリデーションエラー', 'error');
        return;
    }

    editData.carrier_zones.push({ carrier, country_code, zone });
    renderCarrierZonesTable();
    await saveDataWithMessage('carrier_zones', editData.carrier_zones, '追加しました');
}

async function editCarrierZone(index) {
    if (index < 0) return;
    const row = editData.carrier_zones[index];
    if (!row) return;

    const carrier = normalizeCarrierInput(prompt('キャリア:', row.carrier));
    if (carrier === null) return;

    const country_code = String(prompt('国コード:', row.country_code) || '').trim().toUpperCase();
    if (country_code === null) return;

    const zone = normalizeZoneInput(prompt('ゾーン:', row.zone));
    if (zone === null) return;

    // クライアント側バリデーション（自分自身は除外して重複チェック）
    const next = { carrier, country_code, zone };
    const others = (editData.carrier_zones || []).filter((_, i) => i !== index);
    const validCarriers = new Set(getServiceCarriers().map(normalizeCarrierInput));
    const validCountryCodes = new Set(getCountryCodes().map(cc => String(cc).toUpperCase()));
    const key = buildCarrierZoneKey(next.carrier, next.country_code);
    const otherKeys = new Set(others.map(r => buildCarrierZoneKey(r?.carrier, r?.country_code)).filter(Boolean));
    if (!key) {
        showToast('carrier と country_code は必須です', 'error');
        return;
    }
    if (otherKeys.has(key)) {
        showToast(`carrier,country_code が同じ組み合わせが存在します: ${key}`, 'error');
        return;
    }
    if (!validCountryCodes.has(next.country_code)) {
        showToast(`存在しない国コードが含まれています: ${next.country_code}`, 'error');
        return;
    }
    if (!validCarriers.has(next.carrier)) {
        showToast(`存在しないキャリアが含まれています: ${next.carrier}`, 'error');
        return;
    }

    editData.carrier_zones[index] = { carrier, country_code, zone };
    renderCarrierZonesTable();
    await saveDataWithMessage('carrier_zones', editData.carrier_zones, '変更しました');
}

async function deleteCarrierZone(index) {
    if (index < 0) return;
    if (confirm('このマッピングを削除しますか？')) {
        editData.carrier_zones.splice(index, 1);
        renderCarrierZonesTable();
        await saveDataWithMessage('carrier_zones', editData.carrier_zones, '削除しました');
    }
}

// ==========================================
// 設定管理
// ==========================================

function renderSettings() {
    document.getElementById('settingTitle').value = editData.settings.title || '';
    document.getElementById('settingSubtitle').value = editData.settings.subtitle || '';
    document.getElementById('settingNotes').value = (editData.settings.notes || '').replace(/\|/g, '\n');
    document.getElementById('settingFooter').value = editData.settings.footer || '';
}

async function saveSettings() {
    editData.settings = {
        title: document.getElementById('settingTitle').value,
        subtitle: document.getElementById('settingSubtitle').value,
        notes: document.getElementById('settingNotes').value.replace(/\n/g, '|'),
        footer: document.getElementById('settingFooter').value
    };
    
    try {
        const result = await AdminAPI.saveData('settings', editData.settings);
        if (result.success) {
            showToast('設定を保存しました', 'success');
        } else {
            showToast(result.error || '保存に失敗しました', 'error');
        }
    } catch (error) {
        showToast('サーバーエラーが発生しました', 'error');
    }
}

// ==========================================
// CSVアップロード
// ==========================================

function initUploadZones() {
    // 運賃データアップロード
    initUploadZone('ratesUpload', 'ratesFile', 'rates', () => {
        loadAllAdminData();
    }, () => {
        const append = document.getElementById('ratesUploadAppendMode')?.checked;
        return { mode: append ? 'append' : 'replace' };
    });
    
    // 国データアップロード
    initUploadZone('countriesUpload', 'countriesFile', 'countries', () => {
        loadAllAdminData();
    }, () => {
        const append = document.getElementById('countriesUploadAppendMode')?.checked;
        return { mode: append ? 'append' : 'replace' };
    });

    // キャリア別ゾーンマッピング
    initUploadZone('carrierZonesUpload', 'carrierZonesFile', 'carrier_zones', () => {
        loadAllAdminData();
    }, () => {
        const append = document.getElementById('carrierZonesUploadAppendMode')?.checked;
        return { mode: append ? 'append' : 'replace' };
    });
}

function initUploadZone(zoneId, fileId, type, callback, getExtraFields) {
    const zone = document.getElementById(zoneId);
    const fileInput = document.getElementById(fileId);
    
    if (!zone || !fileInput) return;
    zone.addEventListener('click', () => fileInput.click());
    
    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('dragover');
    });
    
    zone.addEventListener('dragleave', () => {
        zone.classList.remove('dragover');
    });
    
    zone.addEventListener('drop', async (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file) await uploadCSV(type, file, callback, getExtraFields);
    });
    
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) await uploadCSV(type, file, callback, getExtraFields);
        fileInput.value = '';
    });
}

async function uploadCSV(type, file, callback, getExtraFields) {
    try {
        if (confirm('CSVファイルを読み込んでデータを更新しますか？')) {
            const extraFields = typeof getExtraFields === 'function' ? getExtraFields() : {};
            const result = await AdminAPI.uploadCSV(type, file, extraFields);
            if (result.success) {
                showToast(result.message || 'アップロードしました', 'success');
                if (callback) callback();
            } else {
                showToast(result.error || 'アップロードに失敗しました', 'error');
            }
        }
    } catch (error) {
        showToast('サーバーエラーが発生しました', 'error');
    }
}

// ==========================================
// CSVダウンロード
// ==========================================

function downloadTemplate(type) {
    let content = '';
    let filename = '';
    
    switch (type) {
        case 'rates':
            content = 'service,zone,weight,price\nFedEx FICP,1,0.5,3500\nFedEx FICP,1,1,4200';
            filename = 'rates_template.csv';
            break;
        case 'countries':
            content = 'name,code\nアメリカ,US\n日本,JP';
            filename = 'countries_template.csv';
            break;
        case 'carrier_zones':
            content = 'carrier,country_code,zone\nfedex,US,E\ndhl,US,5';
            filename = 'carrier_zones_template.csv';
            break;
    }
    
    // BOM付きUTF-8
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const blob = new Blob([bom, content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    
    URL.revokeObjectURL(url);
}

function downloadCurrentData(type) {
    let content = '';
    let filename = '';
    
    switch (type) {
        case 'rates':
            content = 'service,zone,weight,price\n';
            content += editData.rates.map(r => 
                `${r.service},${r.zone},${r.weight},${r.price}`
            ).join('\n');
            filename = 'rates_backup.csv';
            break;
        case 'countries':
            content = 'name,code\n';
            content += editData.countries.map(c => 
                `${c.name},${c.code}`
            ).join('\n');
            filename = 'countries_backup.csv';
            break;
        case 'services':
            content = 'id,name,carrier,color,description,country_codes,use_actual_weight\n';
            content += editData.services.map(s => 
                `${s.id},${s.name},${s.carrier || ''},${s.color},${s.description},${s.country_codes || ''},${s.use_actual_weight ? 1 : 0}`
            ).join('\n');
            filename = 'services_backup.csv';
            break;
        case 'carrier_zones':
            content = 'carrier,country_code,zone\n';
            content += editData.carrier_zones.map(z =>
                `${z.carrier},${z.country_code},${z.zone}`
            ).join('\n');
            filename = 'carrier_zones_backup.csv';
            break;
    }
    
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const blob = new Blob([bom, content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    
    URL.revokeObjectURL(url);
}

// ==========================================
// Toast通知
// ==========================================

function showToast(message, type = '') {
    const toast = document.getElementById('toast');
    // 既存タイマーを解除
    if (toastTimerId) {
        clearTimeout(toastTimerId);
        toastTimerId = null;
    }

    // XSS回避のため textContent で表示
    toast.textContent = message;
    toast.className = 'toast';
    if (type) toast.classList.add(type);
    if (type === 'error') toast.classList.add('sticky');
    toast.classList.add('visible');

    // 閉じるボタン（クリックで消せる）
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'toast-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => {
        toast.classList.remove('visible');
    });
    toast.appendChild(closeBtn);

    // エラー以外は自動で消す
    if (type !== 'error') {
        toastTimerId = setTimeout(() => {
            toast.classList.remove('visible');
            toastTimerId = null;
        }, 3000);
    }
}

// ==========================================
// 初期化
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
    // ログインフォーム
    document.getElementById('loginBtn').addEventListener('click', login);
    document.getElementById('password').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') login();
    });
    
    // ログアウト
    document.getElementById('logoutBtn').addEventListener('click', logout);
    
    // タブ初期化
    initTabs();
    
    // アップロードゾーン初期化
    initUploadZones();

    // キャリア別ゾーン: フィルタ/逆引き入力
    ['carrierZonesCarrierFilter', 'carrierZonesZoneFilter', 'carrierZonesLookup'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', () => {
            if (currentTab === 'carrier_zones') renderCarrierZonesTable();
            else updateCarrierZonesLookup();
        });
    });
    
    // 認証チェック
    checkAuth();
});
