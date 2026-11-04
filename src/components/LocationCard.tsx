import { useState } from 'react';
import { TR_CITIES, getLoc, hhmm, prayerTimes, setLoc } from '../lib/prayerTimes';
import { PRAYERS } from '../db/schema';
import { slotName } from '../lib/slots';
import { useUI } from './ui';
import { t } from '../i18n';

/** اختيار موقع حساب مواقيت الصلاة (افتراضيًا سيواس) */
export function LocationCard() {
  const ui = useUI();
  const [loc, setL] = useState(getLoc());
  const [busy, setBusy] = useState(false);
  const times = prayerTimes(new Date(), loc);
  const apply = (l: typeof loc) => {
    setLoc(l);
    setL(l);
    ui.toast(t('loc_set', { name: l.name }));
  };
  const gps = () => {
    if (!navigator.geolocation) return ui.toast(t('loc_failed', { e: '—' }), true);
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setBusy(false);
        apply({ name: t('my_loc') + ` (${p.coords.latitude.toFixed(2)}, ${p.coords.longitude.toFixed(2)})`, lat: p.coords.latitude, lng: p.coords.longitude });
      },
      (e) => {
        setBusy(false);
        ui.toast(t('loc_failed', { e: e.message }), true);
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 },
    );
  };
  const cityIdx = TR_CITIES.findIndex(([n]) => n === loc.name);
  return (
    <div className="card">
      <h3>{t('prayer_loc')}</h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        {t('prayer_loc_hint')}
      </p>
      <select
        value={cityIdx >= 0 ? String(cityIdx) : ''}
        onChange={(e) => {
          const c = TR_CITIES[Number(e.target.value)];
          if (c) apply({ name: c[0], lat: c[1], lng: c[2] });
        }}
      >
        {cityIdx < 0 && <option value="">{loc.name || t('pick_city')}</option>}
        {TR_CITIES.map(([n], i) => (
          <option key={n} value={i}>
            {n}
          </option>
        ))}
      </select>
      <div className="sp" />
      <button className="btn sm ghost block" disabled={busy} onClick={gps}>
        {busy ? '...' : t('use_my_loc')}
      </button>
      <div className="row wrap small" style={{ marginTop: 10, gap: 6, justifyContent: 'space-between' }}>
        {PRAYERS.map((p) => (
          <span key={p} className="pill gray">
            {slotName(p)} {hhmm(times[p])}
          </span>
        ))}
      </div>
    </div>
  );
}
