// Starter templates for new projects. Plain HTML, CSS and JS: no packages, no build step,
// no outside requests, so they preview and publish immediately (publishing needs index.html).

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const BASE_CSS = `*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.6;background:var(--bg);color:var(--text)}
img,svg{max-width:100%}
a{color:var(--accent)}
.wrap{max-width:960px;margin:0 auto;padding:0 20px}
.btn{display:inline-block;min-height:44px;padding:12px 22px;border-radius:12px;background:var(--accent);color:#fff;font-weight:600;text-decoration:none;border:0;cursor:pointer;font-size:16px}
.btn.ghost{background:transparent;color:var(--text);border:1px solid var(--line)}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
h1,h2,h3{line-height:1.2;margin:0 0 12px}
section{padding:48px 0}
footer{padding:32px 0;color:var(--muted);font-size:14px;border-top:1px solid var(--line)}`;

const DARK = `:root{--bg:#0b0b10;--card:#14141c;--line:#262633;--text:#f4f4f7;--muted:#9a9aae;--accent:#7c3aed}`;
const LIGHT = `:root{--bg:#fafaf7;--card:#ffffff;--line:#e5e5dd;--text:#1b1b18;--muted:#6b6b60;--accent:#0f766e}`;

const head = (title, description) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="stylesheet" href="style.css">
</head>`;

const TEMPLATES = [
  {
    id: 'blank',
    name: 'Blank',
    description: 'Start from nothing and build it with K-XpertAI.',
    files: () => [],
  },
  {
    id: 'landing',
    name: 'Landing page',
    description: 'Headline, features and a call to action for a product or business.',
    files: (n) => [
      { path: 'index.html', content: `${head(n, `${n}: what we do and how to reach us`)}
<body>
<header class="wrap" style="padding-top:20px;display:flex;justify-content:space-between;align-items:center"><strong>${n}</strong><a class="btn ghost" href="#contact">Contact</a></header>
<main>
<section class="wrap" style="text-align:center;padding-top:72px">
<h1 style="font-size:clamp(32px,7vw,56px)">A clear headline about ${n}</h1>
<p style="color:var(--muted);max-width:560px;margin:0 auto 24px">One or two sentences that tell visitors what you offer and who it is for.</p>
<a class="btn" href="#contact">Get started</a>
</section>
<section class="wrap"><div class="grid">
<div class="card"><h3>Fast</h3><p style="color:var(--muted);margin:0">Explain your first big benefit here.</p></div>
<div class="card"><h3>Simple</h3><p style="color:var(--muted);margin:0">Explain your second benefit here.</p></div>
<div class="card"><h3>Reliable</h3><p style="color:var(--muted);margin:0">Explain your third benefit here.</p></div>
</div></section>
<section class="wrap" id="contact" style="text-align:center"><h2>Ready to talk?</h2>
<p style="color:var(--muted)">Replace this with your email or WhatsApp link.</p>
<a class="btn" href="mailto:hello@example.com">Email us</a></section>
</main>
<footer><div class="wrap">&copy; <span id="year"></span> ${n}</div></footer>
<script src="script.js"></script>
</body>
</html>
` },
      { path: 'style.css', content: `${DARK}\n${BASE_CSS}\n` },
      { path: 'script.js', content: `document.getElementById('year').textContent = new Date().getFullYear();\n` },
    ],
  },
  {
    id: 'portfolio',
    name: 'Portfolio',
    description: 'Introduce yourself and show your best work.',
    files: (n) => [
      { path: 'index.html', content: `${head(n, `${n}: portfolio`)}
<body>
<header class="wrap" style="padding-top:48px"><h1 style="font-size:clamp(30px,6vw,48px)">Hi, I'm ${n}.</h1>
<p style="color:var(--muted);max-width:560px">I build things people use. Write one friendly line about what you do and where you are based.</p></header>
<main>
<section class="wrap"><h2>Selected work</h2><div class="grid">
<article class="card"><h3>Project one</h3><p style="color:var(--muted)">What it is and what you did.</p><a href="#">View project</a></article>
<article class="card"><h3>Project two</h3><p style="color:var(--muted)">What it is and what you did.</p><a href="#">View project</a></article>
<article class="card"><h3>Project three</h3><p style="color:var(--muted)">What it is and what you did.</p><a href="#">View project</a></article>
</div></section>
<section class="wrap"><h2>About</h2><p style="max-width:620px;color:var(--muted)">Tell your story in a short paragraph: your skills, your experience and what you enjoy working on.</p></section>
<section class="wrap"><h2>Get in touch</h2><p><a class="btn" href="mailto:hello@example.com">Say hello</a> <a class="btn ghost" href="#">GitHub</a></p></section>
</main>
<footer><div class="wrap">&copy; <span id="year"></span> ${n}</div></footer>
<script src="script.js"></script>
</body>
</html>
` },
      { path: 'style.css', content: `${LIGHT}\n${BASE_CSS}\n` },
      { path: 'script.js', content: `document.getElementById('year').textContent = new Date().getFullYear();\n` },
    ],
  },
  {
    id: 'links',
    name: 'Link page',
    description: 'One page with your name and all your important links.',
    files: (n) => [
      { path: 'index.html', content: `${head(n, `${n}: links`)}
<body>
<main style="max-width:440px;margin:0 auto;padding:48px 20px;text-align:center">
<div id="avatar" aria-hidden="true" style="width:88px;height:88px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-size:36px;font-weight:700;margin:0 auto 16px"></div>
<h1 style="font-size:28px">${n}</h1>
<p style="color:var(--muted);margin:0 0 28px">A short line about who you are and what you do.</p>
<nav style="display:grid;gap:12px">
<a class="btn" href="#">My website</a>
<a class="btn ghost" href="#">WhatsApp me</a>
<a class="btn ghost" href="#">Instagram</a>
<a class="btn ghost" href="#">Latest video</a>
</nav>
</main>
<script src="script.js"></script>
</body>
</html>
` },
      { path: 'style.css', content: `${DARK}\n${BASE_CSS}\n` },
      { path: 'script.js', content: `var name = document.querySelector('h1').textContent.trim();\ndocument.getElementById('avatar').textContent = name.charAt(0).toUpperCase();\n` },
    ],
  },
  {
    id: 'shop',
    name: 'Shop catalog',
    description: 'Product grid with a simple cart and order-by-WhatsApp button.',
    files: (n) => [
      { path: 'index.html', content: `${head(n, `${n}: shop`)}
<body>
<header class="wrap" style="padding-top:20px;display:flex;justify-content:space-between;align-items:center"><strong>${n}</strong><span class="card" style="padding:8px 14px">Cart: <b id="count">0</b></span></header>
<main class="wrap"><section><h1>Our products</h1><div class="grid" id="products"></div></section>
<section id="cart" class="card" hidden><h2>Your order</h2><ul id="items" style="padding-left:20px"></ul><p><b>Total: <span id="total"></span></b></p>
<a class="btn" id="order" href="#">Order on WhatsApp</a> <button class="btn ghost" id="clear" type="button">Clear</button></section></main>
<footer><div class="wrap">&copy; <span id="year"></span> ${n}</div></footer>
<script src="script.js"></script>
</body>
</html>
` },
      { path: 'style.css', content: `${LIGHT}\n${BASE_CSS}\n.price{font-weight:700;margin:4px 0 12px}\n.thumb{height:120px;border-radius:12px;background:linear-gradient(135deg,var(--accent),#99f6e4);margin-bottom:12px}\n` },
      { path: 'script.js', content: `// Edit the products below, and put your WhatsApp number (digits only, with country code) in PHONE.
var PHONE = '2340000000000';
var PRODUCTS = [
  { name: 'Product one', price: 5000 },
  { name: 'Product two', price: 7500 },
  { name: 'Product three', price: 12000 },
  { name: 'Product four', price: 3500 },
  { name: 'Product five', price: 9000 },
  { name: 'Product six', price: 15000 }
];
var cart = [];
function naira(n) { return '\\u20A6' + n.toLocaleString('en-NG'); }
function render() {
  document.getElementById('count').textContent = cart.length;
  var box = document.getElementById('cart');
  box.hidden = cart.length === 0;
  var list = document.getElementById('items');
  list.innerHTML = '';
  var total = 0;
  cart.forEach(function (p) {
    total += p.price;
    var li = document.createElement('li');
    li.textContent = p.name + ' - ' + naira(p.price);
    list.appendChild(li);
  });
  document.getElementById('total').textContent = naira(total);
  var text = 'Hello, I would like to order: ' + cart.map(function (p) { return p.name; }).join(', ') + '. Total ' + naira(total);
  document.getElementById('order').href = 'https://wa.me/' + PHONE + '?text=' + encodeURIComponent(text);
}
var grid = document.getElementById('products');
PRODUCTS.forEach(function (p) {
  var card = document.createElement('article');
  card.className = 'card';
  card.innerHTML = '<div class="thumb"></div><h3></h3><p class="price"></p><button class="btn" type="button">Add to order</button>';
  card.querySelector('h3').textContent = p.name;
  card.querySelector('.price').textContent = naira(p.price);
  card.querySelector('button').addEventListener('click', function () { cart.push(p); render(); });
  grid.appendChild(card);
});
document.getElementById('clear').addEventListener('click', function () { cart = []; render(); });
document.getElementById('year').textContent = new Date().getFullYear();
render();
` },
    ],
  },
  {
    id: 'dashboard',
    name: 'Dashboard',
    description: 'Stat cards, a simple chart and a table with sample data.',
    files: (n) => [
      { path: 'index.html', content: `${head(n, `${n}: dashboard`)}
<body>
<header class="wrap" style="padding-top:20px"><h1 style="font-size:26px">${n}</h1><p style="color:var(--muted);margin:0">Sample data. Replace it with your own.</p></header>
<main class="wrap">
<section><div class="grid" id="stats"></div></section>
<section><div class="card"><h2>Sales this week</h2><div id="chart" style="display:flex;align-items:flex-end;gap:8px;height:160px"></div><div id="labels" style="display:flex;gap:8px;color:var(--muted);font-size:12px;margin-top:6px"></div></div></section>
<section><div class="card" style="overflow-x:auto"><h2>Recent orders</h2><table id="rows" style="width:100%;border-collapse:collapse"><thead><tr><th align="left">Customer</th><th align="left">Item</th><th align="right">Amount</th></tr></thead><tbody></tbody></table></div></section>
</main>
<script src="script.js"></script>
</body>
</html>
` },
      { path: 'style.css', content: `${DARK}\n${BASE_CSS}\n.stat b{display:block;font-size:28px}\n.bar{flex:1;background:var(--accent);border-radius:6px 6px 0 0;min-height:4px}\nth,td{padding:10px 8px;border-bottom:1px solid var(--line)}\n` },
      { path: 'script.js', content: `var STATS = [['Revenue', '\\u20A6482,000'], ['Orders', '126'], ['Customers', '89'], ['Refunds', '3']];
var DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
var SALES = [40, 65, 52, 80, 95, 120, 70];
var ORDERS = [['Amina B.', 'Ankara fabric', '\\u20A612,000'], ['Chidi O.', 'Leather bag', '\\u20A618,500'], ['Fatima Y.', 'Shea butter set', '\\u20A65,000']];
var stats = document.getElementById('stats');
STATS.forEach(function (s) {
  var d = document.createElement('div');
  d.className = 'card stat';
  d.innerHTML = '<span style="color:var(--muted)"></span><b></b>';
  d.querySelector('span').textContent = s[0];
  d.querySelector('b').textContent = s[1];
  stats.appendChild(d);
});
var max = Math.max.apply(null, SALES);
SALES.forEach(function (v, i) {
  var bar = document.createElement('div');
  bar.className = 'bar';
  bar.style.height = Math.round((v / max) * 100) + '%';
  bar.title = DAYS[i] + ': ' + v;
  document.getElementById('chart').appendChild(bar);
  var l = document.createElement('div');
  l.style.flex = '1';
  l.style.textAlign = 'center';
  l.textContent = DAYS[i];
  document.getElementById('labels').appendChild(l);
});
var body = document.querySelector('#rows tbody');
ORDERS.forEach(function (r) {
  var tr = document.createElement('tr');
  r.forEach(function (cell, i) {
    var td = document.createElement('td');
    td.textContent = cell;
    if (i === 2) td.align = 'right';
    tr.appendChild(td);
  });
  body.appendChild(tr);
});
` },
    ],
  },
];

export const TEMPLATE_LIST = TEMPLATES.map(({ id, name, description }) => ({ id, name, description }));

/** Files for a template with the project name filled in (escaped). Unknown id returns no files. */
export function renderTemplate(id, projectName) {
  const template = TEMPLATES.find((t) => t.id === id);
  if (!template) return [];
  return template.files(escapeHtml(projectName || 'My project'));
}
