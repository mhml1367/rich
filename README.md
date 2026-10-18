# مسیر ثروت — موتور اقتصادی و اتاق‌های بازی

این مخزن یک بک‌اند مستقل NestJS با PostgreSQL و Redis برای اقتصاد شبیه‌سازی‌شده و نوبت‌های اتاق‌های بازی است. پارامترهای سناریو **ساختگی و مخصوص بازی** هستند؛ نرخ یا پیش‌بینی اقتصاد واقعی ایران نیستند.

## راه‌اندازی

Node.js 22 یا جدیدتر، PostgreSQL و Redis لازم است. پایگاه داده را بسازید، `DATABASE_URL` و `REDIS_URL` را مطابق `.env.example` تنظیم کنید و سپس اجرا کنید:

```powershell
npm.cmd install
npm.cmd run migrate
npm.cmd run build
npm.cmd test
npm.cmd run settle -- <room-uuid> 1405-07 high_inflation
npm.cmd start
```

هر اتاق شاخص قیمت، حساب‌ها و دوره‌های مستقل دارد. هر دوره فقط یک بار و به ترتیب ماه‌های شمسی تسویه می‌شود. تسویه در یک تراکنش PostgreSQL انجام می‌شود؛ تکرار همان فرمان نتیجهٔ قبلی را برمی‌گرداند. مهلت نوبت در PostgreSQL ثبت و با BullMQ روی Redis زمان‌بندی می‌شود. هنگام راه‌اندازی و هر دقیقه، نوبت‌های باز یا نیمه‌تمام دوباره در صف بررسی می‌شوند.

مسیرها: `POST /rooms`، `POST /rooms/:roomId/join`، `GET /rooms/:roomId`، `POST /rooms/:roomId/decisions/:periodKey`، `POST /rooms/:roomId/buildings/:buildingId/:periodKey`، `GET /economy/scenarios`، `GET /economy/categories` و `GET /economy/rooms/:roomId/periods/:periodKey/indices`. برای مسیرهای مربوط به اتاق، توکن بازیکن را در `Authorization: Bearer <token>` بفرستید. توکن فقط هنگام ساخت یا ورود بازگردانده می‌شود. مبلغ و شاخص در خروجی JSON به شکل رشته فرستاده می‌شود تا دقت عدد صحیح در کلاینت از بین نرود.

## امتیاز و آزادی مالی

فیلد `financial` در snapshot بازیکن، ارزش واقعی دارایی، بدهی، وجه نقد، درآمد غیرفعال و تعهد ماهانه را با شاخص ترکیبی قیمت‌ها گزارش می‌کند. ترکیب شاخص از وزن‌های خوراک ۲۰٪، مسکن ۲۵٪، خودرو ۵٪، طلا ۱۰٪، ارز ۱۰٪، تجهیزات ۱۰٪ و مواد اولیه ۲۰٪ استفاده می‌کند. امتیاز کل از ثروت واقعی ۲۵٪، نقدینگی ۱۵٪، سلامت بدهی ۲۰٪، پوشش هزینه از درآمد غیرفعال ۳۰٪ و کیفیت زندگی ۱۰٪ ساخته می‌شود.

بازیکن ورشکسته یا دارای حداقل سه ماه معوقه می‌تواند در دورهٔ فعال از `POST /rooms/:roomId/restructure/:periodKey` استفاده کند. ماندهٔ وام‌ها، اجارهٔ عقب‌افتاده و مطالبات ضمانت به یک وام ثابت ۳۶ ماهه با نرخ مرجع سناریوی جاری منتقل می‌شوند؛ جریمهٔ ماهانهٔ وام تجمیعی صفر است. بازسازی دوباره تا گذشت سه ماه شمسی مجاز نیست. ردیف‌های قدیمی و رخداد بازسازی برای تاریخچه نگه داشته می‌شوند و مطالبات ضمانت تجمیع‌شده از بدهی فعال حذف می‌شوند.

شرط آزادی مالی: درآمد غیرفعال حداقل برابر تعهد ماهانه باشد، ثروت خالص واقعی دست‌کم ۲۴ برابر تعهد ماهانه برسد و بدهی حداکثر ۳۵٪ دارایی باشد. ثروت خالص واقعی منفی، وضعیت ورشکستگی را نشان می‌دهد؛ معوقهٔ حداقل سه ماه تعهد، وضعیت بازسازی بدهی را فعال می‌کند. این وضعیت‌ها در محاسبهٔ snapshot هستند و سابقهٔ پیوستگی چند دوره‌ای هنوز نگه‌داری نمی‌شود.

نمونهٔ بدنهٔ ساخت اتاق: `{"title":"شهر من","displayName":"بازیکن یک","mode":"async","scenarioId":"recession","turnSeconds":86400}`. حالت‌های موجود `solo`، `live` و `async` هستند. هر اتاق در آغاز یک بازیکن با ۱۰٬۰۰۰٬۰۰۰ تومان نقد، حقوق ماهانهٔ ۶٬۰۰۰٬۰۰۰ تومان و اجارهٔ ۲٬۰۰۰٬۰۰۰ تومان دارد. این مقادیر نمونه‌اند.

برای سرمایه‌گذاری در ماه جاری، بدنهٔ سفارش خرید یا فروش به شکل `{"action":"buy","category":"gold","amountTomans":"1000000"}` است. دسته‌های قابل معامله در این مرحله `car`، `gold`، `currency`، `equipment` و `materials` هستند. مقدار باید رشتهٔ عدد صحیح تومان باشد. سفارش را تا قبل از قفل دوره می‌توان جایگزین کرد. خرید پس از حقوق و اجاره و پیش از تسویهٔ چک‌ها و وام‌ها اجرا می‌شود؛ سفارش با موجودی ناکافی رد می‌شود. فروش با ارزش اسمی فعلی دارایی انجام می‌شود و از موجودی همان دسته بیشتر نمی‌تواند باشد. دارایی‌های باقی‌مانده در هر دوره با شاخص گروه خود ارزش‌گذاری می‌شوند. سفارش‌های بی‌اقدام در پایان دوره به سیاست نمایندهٔ محافظه‌کار (نگهداری وجه) می‌رسند.

کلاینت به namespace وب‌سوکت `/rooms` وصل می‌شود و پیام `room.join` با `{roomId,token}` می‌فرستد. پس از تأیید، رویدادهای `period.locked`، `period.result.published`، `period.opened` و `room.members.changed` را دریافت می‌کند. پس از اتصال مجدد، `GET /rooms/:roomId` نمای معتبر را برمی‌گرداند.

## واحدها و فرمول‌ها

- هر مبلغ، **تومانِ صحیح** است؛ مقدار اعشاری پول نگهداری نمی‌شود. نرخ‌ها بر حسب نقطهٔ پایه‌اند: `10000 = 100%`.
- شاخص پایهٔ هر دسته `1,000,000` است. شاخص دورهٔ بعد: `round(شاخص فعلی × (10000 + تغییر ماهانه) ÷ 10000)`.
- ارزش واقعی به تومان دورهٔ پایه: `round(ارزش اسمی × شاخص پایه ÷ شاخص فعلی)`. برای قدرت خرید یک کالای خاص، شاخص همان دسته استفاده می‌شود. برای سبد مصرف، میانگین وزنی شاخص‌ها با وزن‌هایی که جمعشان `10000` است به کار می‌رود.
- مبلغ اسمی لازم برای حفظ قدرت خرید: `round(مبلغ دورهٔ پایه × شاخص فعلی ÷ شاخص پایه)`.
- حقوق هر ماه با نرخ دستمزد سناریو تغییر می‌کند؛ اجاره با نسبت شاخص مسکنِ جدید به قبلی تعدیل می‌شود. اجارهٔ پرداخت‌نشده به بدهی اجاره تبدیل می‌شود و پرداخت‌های بعدی ابتدا بدهی قدیمی‌تر را تسویه می‌کنند.
- سود ماهانهٔ وام: `round(اصل باقی‌مانده × نرخ سالانه ÷ 120000)`. نرخ ثابت از قرارداد و نرخ متغیر از `نرخ مرجع سناریو + حاشیهٔ قرارداد` می‌آید. قسط ثابت با جست‌وجوی صحیح کمترین مبلغی محاسبه می‌شود که بدهی را در تعداد ماه مقرر صاف کند. برای نرخ متغیر قسط با نرخ همان ماه دوباره محاسبه می‌شود.
- جریمهٔ دیرکرد ماهانه روی جمع معوقهٔ سود، اصل و جریمه اعمال می‌شود. پرداخت به ترتیب به جریمه، سود معوق، سود جاری، اصل معوق و اصل جاری تخصیص می‌یابد. اصل تا وقتی واقعاً پرداخت نشده کاهش نمی‌یابد.
- چک در ماه سررسید از موجودی صادرکننده به دریافت‌کننده منتقل می‌شود. کسری موجودی، چک را برگشت می‌زند. ضمانت تا سقف قرارداد به‌صورت مطالبهٔ ثبت‌شده علیه ضامن شناسایی می‌شود؛ پرداخت یا وصول قضایی این مطالبه در این مرحله خودکار نیست.

## سناریوها و داده‌ها

سناریوهای `recession`، `boom`، `high_inflation` و `market_shock` تغییر مستقل خوراک، مسکن، خودرو، طلا، ارز، تجهیزات و مواد اولیه را تعریف می‌کنند. نرخ دستمزد و نرخ مرجع وام متغیر نیز مستقل‌اند. همهٔ ضرایب در `src/economy/scenarios.ts` نسخهٔ فعلی دارند و برای بالانس بازی قابل تغییرند؛ تغییر آن‌ها پس از انتشار یک دوره نباید بدون نسخه‌بندی قواعد انجام شود.

زمان واقعی در سرور با UTC نگهداری می‌شود. کلید دوره `YYYY-MM` شمسی است و تبدیل تاریخ برای نمایش با تقویم Persian و منطقهٔ `Asia/Tehran` انجام می‌شود. تسویهٔ دوره باید پس از بسته‌شدن همان دوره توسط سامانهٔ نوبت انجام شود.

## وضعیت پیاده‌سازی

مخزن شامل موتور اقتصاد، API اتاق و تصمیم‌ها، رقبا و نمایندهٔ خودکار، ساخت شهر، امتیاز آزادی مالی، وام، چک و ضمانت، بازپرداخت مطالبات، رابط React/PixiJS، نمودار روند بازار، WebSocket و صف BullMQ است. توکن اتاق، هویت سراسری کاربر نیست. طرح SQL فعلی برای پایگاه دادهٔ تازه آماده است و مهاجرت از طرح قدیمیِ بدون `room_id` عمداً متوقف می‌شود تا پیش از انتقال داده، نسخهٔ پشتیبان و نگاشت اتاق‌ها آماده شود. آزمون‌های PGlite جریان‌های مالی و چنددوره‌ای را پوشش می‌دهند؛ آزمون اتصال به سرویس‌های واقعی به PostgreSQL و Redis اجراشده نیاز دارد.


## Automatic delegate

When a player submits no order before a turn closes, the automatic delegate reserves due checks, loan installments, and one extra month of rent and loan service. It invests at most 25% of the remaining surplus in the investable category with the strongest positive change in the active scenario, and keeps cash when the order would be below 100,000 tomans. The decision stays marked delegated with its strategy reason.

Solo rooms start with two AI rivals. The growth rival invests half of free surplus in the strongest positive scenario trend. The defensive rival reserves two months of rent and loan service, then places a smaller share in gold or currency as a hedge. Both follow the same settlement, inflation, debt, and city-income rules as human players. Snapshots include a leaderboard ranked by real net worth.

Players may request one 500,000 to 100,000,000 toman loan per active period at POST /rooms/:roomId/loans/:periodKey. Terms are 6-60 months. Fixed rate is the scenario reference plus 500 bps; variable rate uses reference plus 200 bps and reprices with future scenarios. The request is rejected if any arrears remain or if existing plus proposed monthly debt service exceeds 40% of income after rent. Issuance, balance credit, and origination history are committed atomically.

Players can issue a postdated check through POST /rooms/:roomId/check-requests/:periodKey, naming a payee and a human guarantor. The due date must be the next Jalali month. A check and its full-amount guarantee are created together only after the named guarantor accepts via POST /rooms/:roomId/check-requests/:requestId/respond. Pending requests expire when the issuer's turn locks. On maturity, available issuer cash pays the check; otherwise the check bounces and the guarantor's available cash is transferred to the payee up to the guarantee cap. Any unpaid guaranteed amount is recorded as an outstanding guarantee claim.

Outstanding guarantee claims appear as liabilities and reduce real net worth until paid or restructured. Starting in the month after a claim is recorded, settlement automatically allocates up to 10% of the guarantor's monthly salary to old claims, after rent, checks, and loan installments. Cash availability and remaining claim balance limit each payment; every deduction is recorded in the ledger.

## Phone sign-in and first city

`POST /auth/otp/request` accepts `{ "phone": "09123456789", "displayName": "Mina", "mode": "register" }` for registration or `{ "phone": "09123456789", "mode": "login" }` for sign-in. The response contains a six-digit `developmentCode` for five minutes while the app runs outside production; the UI shows this code because no SMS provider is configured. `POST /auth/otp/verify` accepts the phone and code and returns a 30-day bearer session. In production, connect an SMS provider before enabling this flow; the API deliberately does not reveal OTPs there.

The first screen is phone sign-in. After verification, the player can create a city or join a room. `POST /rooms` and `POST /rooms/:roomId/join` require the phone-session bearer token. The game then issues a separate room token for gameplay actions.

## Local full-stack quick start

Requirements: Node.js 22+, Docker Compose.

1. Start PostgreSQL and Redis 6.2 or newer: `docker compose up -d`.
2. Copy `.env.example` to `.env`, then initialize PostgreSQL with `npm install`, `npm run db:create`, and `npm run migrate`.
3. In one terminal run the API: `npm run dev`.
4. In a second terminal run the client: `cd client`, `npm install`, then `npm run dev`.
5. Open `http://127.0.0.1:5173`. The API and Socket.IO server use `http://127.0.0.1:3000` by default.

Production checks: `npm run test`, `npm run build:all`, and `npm run verify:infra`. The infrastructure check verifies PostgreSQL, Redis, and a real BullMQ job round trip. The client uses Vite code splitting: the core interface, Pixi city, and Chart.js market chart load as separate chunks. Market history is available to room members at `GET /economy/rooms/:roomId/history`.
