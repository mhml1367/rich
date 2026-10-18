import { useState } from 'react';

const apiBase = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
export type AuthResult = { user: { id: string; phone: string; displayName: string }; token: string };

type Props = { onAuthenticated: (result: AuthResult) => void };
type ApiMessage = { message?: string | string[]; developmentCode?: string; delivery?: string };

const friendlyError = (message?: string | string[]) => {
  const value = Array.isArray(message) ? message[0] : message;
  const errors: Record<string, string> = {
    invalid_iranian_mobile: 'شمارهٔ موبایل ایران را به شکل ۰۹۱۲۳۴۵۶۷۸۹ وارد کن.',
    invalid_display_name: 'نام بازیکن باید بین ۲ تا ۴۰ نویسه باشد.',
    phone_already_registered: 'این شماره قبلاً ثبت شده؛ وارد شو.',
    phone_not_registered: 'حسابی با این شماره پیدا نشد؛ ثبت‌نام کن.',
    otp_resend_wait: 'برای ارسال دوبارهٔ کد کمی صبر کن.',
    otp_expired_or_missing: 'کد منقضی شده؛ کد تازه بگیر.',
    invalid_otp: 'کد واردشده درست نیست.',
    otp_attempts_exceeded: 'تعداد تلاش‌ها تمام شد؛ کد تازه بگیر.',
    sms_provider_not_configured: 'ارسال پیامک هنوز تنظیم نشده است. در حالت توسعه از کد نمایشی استفاده کن.',
  };
  return errors[value || ''] || value || 'ارتباط با سرور برقرار نشد. دوباره تلاش کن.';
};

export function AuthGate({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [phone, setPhone] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [code, setCode] = useState('');
  const [developmentCode, setDevelopmentCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const sendCode = async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${apiBase}/auth/otp/request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, displayName, mode }),
      });
      const result = await response.json().catch(() => ({})) as ApiMessage;
      if (!response.ok) throw new Error(friendlyError(result.message));
      setDevelopmentCode(result.developmentCode || '');
      setCodeSent(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'ارتباط با سرور برقرار نشد.'); }
    finally { setBusy(false); }
  };

  const verifyCode = async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${apiBase}/auth/otp/verify`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, code }),
      });
      const result = await response.json().catch(() => ({})) as AuthResult & ApiMessage;
      if (!response.ok || !result.token || !result.user) throw new Error(friendlyError(result.message));
      onAuthenticated(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'تأیید کد انجام نشد.'); }
    finally { setBusy(false); }
  };

  return <main className="auth-screen" dir="rtl">
    <div className="auth-city-art" aria-hidden="true"><span className="auth-sun"/><span className="auth-building auth-building-a"/><span className="auth-building auth-building-b"/><span className="auth-building auth-building-c"/><span className="auth-road"/></div>
    <section className="auth-card" aria-labelledby="auth-title">
      <div className="auth-brand"><span className="auth-brand-mark">◆</span><div><small>بازی راهبردی شهر و اقتصاد</small><strong>مسیر ثروت</strong></div></div>
      <p className="auth-kicker">شهر بعدی را تو می‌سازی</p>
      <h1 id="auth-title">{codeSent ? 'تأیید شمارهٔ موبایل' : mode === 'register' ? 'حساب بازیکن بساز' : 'به شهر برگرد'}</h1>
      <p className="auth-description">{codeSent ? `کد شش‌رقمی را برای ${phone} وارد کن.` : 'با شمارهٔ موبایل وارد شو تا شهر تازه‌ات را بسازی یا بازی‌ات را ادامه بدهی.'}</p>

      {!codeSent ? <>
        <div className="auth-tabs" role="tablist" aria-label="نوع ورود">
          <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); }}>ثبت‌نام</button>
          <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); }}>ورود</button>
        </div>
        {mode === 'register' && <label className="auth-label">نام بازیکن<input autoComplete="nickname" maxLength={40} placeholder="مثلاً مینا رضایی" value={displayName} onChange={event => setDisplayName(event.target.value)} /></label>}
        <label className="auth-label">شمارهٔ موبایل<input dir="ltr" inputMode="tel" autoComplete="tel-national" placeholder="09123456789" maxLength={14} value={phone} onChange={event => setPhone(event.target.value)} /></label>
        <button className="auth-primary" type="button" disabled={busy || !phone.trim() || (mode === 'register' && displayName.trim().length < 2)} onClick={() => void sendCode()}>{busy ? 'در حال ارسال…' : 'ارسال کد تأیید'}</button>
      </> : <>
        {developmentCode && <div className="auth-dev-code" role="status"><span>کد آزمایشی ورود</span><strong dir="ltr">{developmentCode}</strong><small>به‌دلیل نبود سرویس پیامک، کد در همین صفحه نمایش داده می‌شود.</small></div>}
        <label className="auth-label">کد شش‌رقمی<input dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="— — — — — —" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
        <button className="auth-primary" type="button" disabled={busy || code.length !== 6} onClick={() => void verifyCode()}>{busy ? 'در حال بررسی…' : 'تأیید و ادامه'}</button>
        <button type="button" className="auth-back" onClick={() => { setCodeSent(false); setCode(''); setDevelopmentCode(''); setError(''); }}>اصلاح شماره یا بازگشت</button>
      </>}
      {error && <p className="auth-error" role="alert">{error}</p>}
      <div className="auth-foot"><span>هر شهر یک فرصت تازه است</span><b>تومان · تقویم شمسی</b></div>
    </section>
  </main>;
}
