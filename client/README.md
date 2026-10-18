# رابط شهر مسیر ثروت

رابط موبایل بازی با React، TypeScript و PixiJS 8 به API اتاق‌ها و WebSocket بک‌اند NestJS متصل می‌شود.

## اجرا

```sh
npm install
npm run dev
```

کلاینت به‌صورت پیش‌فرض به `http://127.0.0.1:3000` وصل می‌شود. برای سرور دیگر، متغیر `VITE_API_URL` را پیش از اجرای Vite تنظیم کنید. مقدار `CORS_ORIGIN` بک‌اند باید مبدأ کلاینت، برای نمونه `http://127.0.0.1:5173`، باشد تا درخواست‌های HTTP و Socket.IO پذیرفته شوند.

## قابلیت‌ها

- ساخت اتاق با حالت تک‌نفره، هم‌زمان یا غیرهم‌زمان و انتخاب سناریوی اقتصادی
- ورود با شناسهٔ دعوت و نام بازیکن
- دریافت snapshot از `GET /rooms/:roomId` و اتصال به namespace `/rooms` با رویداد `room.join`
- همگام‌سازی اعضا، تصمیم‌ها و تغییرات دوره از طریق WebSocket
- مشاهدهٔ کارنامهٔ مالی و امتیاز پنج‌بعدی از پنجرهٔ «شهر من»؛ شرایط آزادی مالی و هشدار بازسازی بدهی از snapshot می‌آیند
- ثبت خرید، فروش، نگه‌داری نقدینگی و ساخت/ارتقای پنج سایت شهر تا سطح ۵
- کسر آنی هزینهٔ ساختمان و ذخیرهٔ سطح و تاریخچه در PostgreSQL؛ درآمد خالص ماهانهٔ ساختمان‌ها در تسویه به موجودی افزوده و با شاخص مرتبط تعدیل می‌شود
- نگه‌داری توکن اتاق فقط در `sessionStorage` و نمایش دوره با تقویم شمسی و مبلغ تومان

ساخت‌وساز از مسیر `POST /rooms/:roomId/buildings/:buildingId/:periodKey` انجام می‌شود. تغییر سطح و کسر موجودی در یک تراکنش ثبت می‌شوند؛ رویداد `city.building.changed` سایر بازیکنان اتاق را مطلع می‌کند. برای اعمال جدول‌های تازه، در ریشهٔ پروژه `npm run migrate` را اجرا کنید. پردازش کامل اتاق‌ها به PostgreSQL و Redis/BullMQ نیاز دارد.

## صحنهٔ وکتوری شهر

`src/PixiCity.tsx` نقشه را با `Graphics` در PixiJS می‌سازد. لایه‌ها به ترتیب زمین و خیابان، قطعه‌های ساختمان، بدنه و نشان‌های شناور، و در پایان خودروها و عابران هستند. ۱۱ ساختمان و مرکز شهری روی نقشه دیده می‌شوند. پنج ساختمان با اقتصاد فعلی قابل ساخت و ارتقا هستند؛ بانک و سایر مراکز خدماتی نقاط ورود به امکانات بازی‌اند.

روی نقشه می‌توان با یک انگشت یا ماوس جابه‌جا شد، با دو انگشت یا چرخ ماوس زوم کرد، و با لمس ساختمان دوربین را روی آن متمرکز کرد. انتخاب ساختمان یک واکنش کوتاه و نور زیر ساختمان ایجاد می‌کند. ظاهر خانه بر اساس ثروت خالص بازیکن در چهار سطح ساخته می‌شود. صحنه از تصویر پس‌زمینهٔ ثابت استفاده نمی‌کند؛ هندسه یک بار ساخته می‌شود و در هر فریم فقط موقعیت عناصر متحرک تغییر می‌کند. وضوح رندر به دو برابر تراکم نمایشگر محدود است، فریم‌ریت سقف ۶۰ دارد و تنظیم کاهش حرکت سیستم رعایت می‌شود.

## Game HUD

The HUD shows real asset value, monthly cash flow, and the Jalali turn number. Inventory reads market positions, buildings, loans, and player-related checks from the room snapshot. Room chat is sent over Socket.IO and retained in PostgreSQL. The round button saves a hold decision when needed and marks the player ready; when all human players are ready, BullMQ settles the turn early. Autopilot settings are stored per room and player and apply to offline turn decisions.
