import fs from 'node:fs/promises';

const read = file => fs.readFile(file, 'utf8');
const original = name => read(`originals/${name}.svg`);
const pagesOrigin = 'https://nancoolhae.github.io';
const pagesBackend = 'https://compass-firefly-exhibition.kwzzah.chatgpt.site';

const palette = JSON.stringify(JSON.parse(await read('palette.json')));
const html = await read('public/index.html');
const css = await read('public/style.css');
const app = (await read('public/app.js')).replace('/* PALETTE */ null', () => palette);

if (process.argv[2] === '--github-pages') {
  const pagesApp = app.replace("/* PAGES_BACKEND */ ''", () => JSON.stringify(pagesBackend));
  const pagesHtml = html
    .replaceAll('="/art/', `="${pagesBackend}/art/`)
    .replace('<link rel="stylesheet" href="/style.css">', () => `<style>\n${css}\n</style>`)
    .replace('<script type="module" src="/app.js"></script>', () => `<script type="module">\n${pagesApp}\n</script>`);
  const directory = process.argv[3] ?? 'docs';
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(`${directory}/index.html`, pagesHtml);
  process.exit(0);
}

// Keep the exported SVG paths and image definitions byte-for-byte.
function children(svg) {
  const nodes = [];
  let depth = 0;
  let start = 0;
  for (const tag of svg.matchAll(/<\/?[\w:-]+(?:\s[^<>]*?)?\s*\/?>/g)) {
    if (tag[0][1] === '/') {
      if (--depth === 0) nodes.push(svg.slice(start, tag.index + tag[0].length));
      continue;
    }
    if (depth === 0) start = tag.index;
    if (!tag[0].endsWith('/>')) depth++;
    else if (depth === 0) nodes.push(tag[0]);
  }
  return nodes;
}

function open(svg) {
  const end = svg.indexOf('>');
  return [svg.slice(0, end + 1), children(svg.slice(end + 1, svg.lastIndexOf('</')))];
}

function compose(header, nodes) {
  return header + nodes.join('\n') + '</' + header.match(/^<([\w:-]+)/)[1] + '>';
}

function keepDefs(defs, markup) {
  const [header, nodes] = open(defs);
  const selected = new Set();
  const indexes = new Map(nodes.map((node, index) => [node.match(/\bid="([^"]+)"/)?.[1], index]));
  function visit(fragment) {
    for (const ref of fragment.matchAll(/(?:url\(#|href="#)([^")]+)/g)) {
      const index = indexes.get(ref[1]);
      if (index === undefined || selected.has(index)) continue;
      selected.add(index);
      visit(nodes[index]);
    }
  }
  visit(markup);
  return compose(header, nodes.filter((_, index) => selected.has(index)));
}

const compass = await original('나침반');
const [compassHeader, [compassMain]] = open(compass);
const [, [, compassContent, ...compassHead]] = open(compassMain);
const [, [, , , , pinkName, , chooseLabel]] = open(compassContent);
const svgFragment = (viewBox, nodes) => compose(
  `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="${viewBox}">`, nodes,
);

const [drawingHeader, drawingNodes] = open(await original('그리기'));
const [emotionHeader, emotionNodes] = open(await original('emotion'));
const emotionDefs = emotionNodes.at(-1);
const [, emotionDefinitions] = open(emotionDefs);
const artPatterns = new Map();
for (const definition of emotionDefinitions.filter(node => node.startsWith('<pattern '))) {
  const [, id] = definition.match(/\bid="([^"]+)"/);
  const [, image, matrix] = definition.match(/xlink:href="#([^"]+)" transform="matrix\(([^)]+)\)"/);
  const [scaleX, , , scaleY, offsetX, offsetY] = matrix.split(/\s+/).map(Number);
  artPatterns.set(id, {
    image,
    crop: [-offsetX / scaleX, -offsetY / scaleY, 1 / scaleX, 1 / scaleY].join(' '),
  });
}
const assets = {
  '/art/start.svg': await original('시작'),
  '/art/compass-heading.svg': svgFragment('0 0 390 222', compassHead.slice(0, -1)),
  '/art/choose-label.svg': svgFragment('160 764 70 24', [chooseLabel]),
  '/art/pink.svg': compose(compassHeader, [pinkName]),
  '/art/drawing.svg': compose(drawingHeader, drawingNodes.filter((_, i) => ![16, 17, 19].includes(i))),
  '/art/placeholder.svg': compose(drawingHeader, [drawingNodes[16]]),
  '/art/hint.svg': compose(drawingHeader, [drawingNodes[17]]),
};

for (const [index, card] of emotionNodes.slice(1, 7).entries()) {
  const rect = card.match(/<rect x="([^"]+)" y="([^"]+)" width="310" height="372"/);
  if (!rect) throw new Error(`Missing emotion card ${index + 1}`);
  const [, x, y] = rect;
  const header = emotionHeader.replace('width="1050" height="825" viewBox="0 0 1050 825"',
    `width="1026" height="1236" viewBox="${Number(x) - 16} ${Number(y) - 16} 342 412"`);

  // Render the existing bitmap crop directly, without an intermediate SVG pattern tile.
  const cropped = card.replace(/<rect (x="[^"]+" y="[^"]+" width="[^"]+" height="[^"]+") fill="url\(#(pattern[^)]+)\)"\/>/g,
    (_, bounds, id) => {
      const { image, crop } = artPatterns.get(id);
      return `<svg ${bounds} viewBox="${crop}" preserveAspectRatio="none" overflow="hidden"><use xlink:href="#${image}"/></svg>`;
    });

  // The exported shadows can be rasterized separately from the lettering and artwork.
  const [outer, [innerGroup]] = open(cropped);
  const [inner, layers] = open(innerGroup);
  const backing = layers[0].startsWith('<rect ') ? layers[0] : open(layers[0])[1][0];
  const shadow = compose(outer, [compose(inner, [backing])]);
  const artwork = [shadow, ...layers];
  assets[`/art/card-${index + 1}.svg`] = compose(header, [...artwork, keepDefs(emotionDefs, artwork.join(''))]);
}

for (const [type, filename, split, width, height, titleHeight] of [
  ['phone', '숲_폰', 5, 390, 844, 158],
  ['wide', '숲_아이패드', 6, 1920, 1080, 190],
]) {
  const [, [scene]] = open(await original(filename));
  const [, nodes] = open(scene);
  const svg = (viewBox, content) => compose(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">`, content);
  assets[`/art/forest-${type}-landscape.svg`] = svg(`0 0 ${width} ${height}`, nodes.slice(0, split));
  assets[`/art/forest-${type}-heading.svg`] = svg(`0 0 ${width} ${titleHeight}`, nodes.slice(split));
}

const embeddedImages = [];
const imageIndexes = new Map();
for (const [name, svg] of Object.entries(assets)) {
  assets[name] = svg.replace(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/gi, data => {
    if (!imageIndexes.has(data)) {
      imageIndexes.set(data, embeddedImages.length);
      embeddedImages.push(data);
    }
    return `__EMBEDDED_IMAGE_${imageIndexes.get(data)}__`;
  });
}
const publicFiles = {
  '/': ['text/html; charset=utf-8', html],
  '/app.js': ['text/javascript; charset=utf-8', app],
  '/style.css': ['text/css; charset=utf-8', css],
  ...Object.fromEntries(Object.entries(assets).map(([url, svg]) => [url, ['image/svg+xml', svg]])),
};

await fs.mkdir('dist/server', { recursive: true });
await fs.mkdir('dist/.openai', { recursive: true });
await fs.copyFile('.openai/hosting.json', 'dist/.openai/hosting.json');
await fs.writeFile('dist/server/index.js', (await read('worker.mjs'))
  .replace('/* FILES */ null', () => JSON.stringify(publicFiles))
  .replace('/* IMAGES */ null', () => JSON.stringify(embeddedImages))
  .replace('/* PAGES_ORIGIN */ null', () => JSON.stringify(pagesOrigin))
  .replace('/* PALETTE */ null', () => palette));
