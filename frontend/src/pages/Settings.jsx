import { useEffect, useState } from 'react';
import api from '../services/api';
import { Toast } from '../components/ui';

export default function Settings() {
  const [form, setForm] = useState({});
  const [toast, setToast] = useState(null);
  const show = (msg, type) => { setToast({ msg, type }); setTimeout(() => setToast(null), 2500); };
  useEffect(() => {
    api.get('/settings').then(({ data }) => {
      const o = {}; data.data.forEach((s) => (o[s.setting_key] = s.setting_value)); setForm(o);
    }).catch(() => {});
  }, []);
  const save = async (e) => {
    e.preventDefault();
    try { await api.put('/settings', form); show('Settings saved'); }
    catch { show('Save failed', 'error'); }
  };
  const F = [
    ['company_name', 'Company Name'], ['fuel_wastage_threshold_l_per_100km', 'Fuel Wastage Threshold (L/100km)'],
    ['fuel_high_cost_threshold', 'High Fuel Cost Alert (₱)'], ['registration_expiry_warning_days', 'Registration Warning (days)'],
    ['license_expiry_warning_days', 'License Warning (days)']
  ];
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">System Settings</h2>
      <form onSubmit={save} className="card grid md:grid-cols-2 gap-3 max-w-3xl">
        {F.map(([k, l]) => (
          <div key={k}><label className="label">{l}</label><input className="input" value={form[k] || ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></div>
        ))}
        <div className="md:col-span-2"><button className="btn-primary btn">Save Settings</button></div>
      </form>
      <Toast toast={toast} />
    </div>
  );
}
