// Easy Outline 1.0.8 — Por Pavito — MIT — Archivo instalable. Generado con npm run build.
(function () {
'use strict';
/* Original implementation. Pure geometry: no Blockbench or DOM dependencies. */
function createOutlineEngine() {
  const EPS = 1e-7;
  const DIRECTIONS = [
    {axis: 0, sign: -1, face: 'east', original: 'west'},
    {axis: 0, sign: 1, face: 'west', original: 'east'},
    {axis: 1, sign: -1, face: 'up', original: 'down'},
    {axis: 1, sign: 1, face: 'down', original: 'up'},
    {axis: 2, sign: -1, face: 'south', original: 'north'},
    {axis: 2, sign: 1, face: 'north', original: 'south'}
  ];
  const round = n => Math.round(n * 1e8) / 1e8;
  function bounds(source, thickness) {
    const lo = [], hi = [];
    for (let a = 0; a < 3; a++) {
      const f = source.from[a], t = source.to[a];
      const stretch = source.stretch?.[a] ?? 1;
      if (![f, t, stretch, source.inflate ?? 0].every(Number.isFinite) || t < f || stretch <= 0) {
        throw new Error('Hay un cubo invertido o con escala no válida. Selecciona solo los cubos originales.');
      }
      const center = (f + t) / 2;
      const half = ((t - f) / 2 + (source.inflate || 0)) * stretch;
      if (half < 0) throw new Error('Un cubo tiene una inflación que invierte su volumen.');
      lo[a] = round(center - half - thickness);
      hi[a] = round(center + half + thickness);
    }
    return {lo, hi};
  }
  function transformKey(source) {
    const rotation = source.rotation || [0, 0, 0];
    const rotated = rotation.some(n => Math.abs(n) > EPS);
    return JSON.stringify([source.parent || 'root', rotation, rotated ? source.origin : [], !!source.rescale]);
  }
  // Rectangle minus rectangle, in disjoint strips. Exact clipping preserves holes.
  function subtract(rect, cut) {
    const x0 = Math.max(rect[0], cut[0]), y0 = Math.max(rect[1], cut[1]);
    const x1 = Math.min(rect[2], cut[2]), y1 = Math.min(rect[3], cut[3]);
    if (x1 - x0 <= EPS || y1 - y0 <= EPS) return [rect];
    return [
      [rect[0], rect[1], x0, rect[3]], [x1, rect[1], rect[2], rect[3]],
      [x0, rect[1], x1, y0], [x0, y1, x1, rect[3]]
    ].filter(r => r[2] - r[0] > EPS && r[3] - r[1] > EPS);
  }
  function overlap(a, b) {
    return a.lo.every((v, i) => Math.min(a.hi[i], b.hi[i]) - Math.max(v, b.lo[i]) > EPS);
  }
  function plan(sources, options = {}) {
    const thickness = Number(options.thickness ?? 0.25);
    if (!Number.isFinite(thickness) || thickness < 0.005 || thickness > 8) {
      throw new Error('El grosor debe estar entre 0.005 y 8 unidades.');
    }
    if (!sources.length) throw new Error('No hay cubos para crear el contorno.');
    if (sources.length > 1000) throw new Error('Selecciona un máximo de 1000 cubos por operación.');
    const boxes = sources.map((s, i) => ({...bounds(s, thickness), source: s, index: i,
      key: transformKey(s), closed: !s.faces || DIRECTIONS.every(d => s.faces[d.original] !== false)}));
    const output = [];
    let clippedFaces = 0;
    const groups = new Map();
    for (const box of boxes) {
      if (!groups.has(box.key)) groups.set(box.key, []);
      groups.get(box.key).push(box);
    }
    for (const box of boxes) {
      const peers = options.clean !== false && box.closed
        ? groups.get(box.key).filter(b => b !== box && b.closed && overlap(box, b)) : [];
      const active = DIRECTIONS.filter(d => box.source.faces?.[d.original] !== false);
      if (!peers.length) {
        output.push({source: box.source.id, from: box.hi.slice(), to: box.lo.slice(), faces: active.map(d => d.face)});
      } else {
        for (const d of active) {
          const axes = [0, 1, 2].filter(a => a !== d.axis);
          const [u, v] = axes;
          const p = d.sign > 0 ? box.hi[d.axis] : box.lo[d.axis];
          let rects = [[box.lo[u], box.lo[v], box.hi[u], box.hi[v]]];
          for (const peer of peers) {
            // A coplanar duplicate belongs to the first source only. The other
            // boundary must cover the outward side, not merely touch from inside.
            const inside = peer.lo[d.axis] < p - EPS && peer.hi[d.axis] > p + EPS;
            const coplanar = Math.abs((d.sign > 0 ? peer.hi[d.axis] : peer.lo[d.axis]) - p) < EPS;
            if (!inside && !(coplanar && peer.index < box.index)) continue;
            rects = rects.flatMap(r => subtract(r, [peer.lo[u], peer.lo[v], peer.hi[u], peer.hi[v]]));
            if (rects.length > 4096) throw new Error('La unión es demasiado compleja. Elige el modo Ligero o selecciona menos cubos.');
            if (!rects.length) break;
          }
          if (rects.length !== 1 || rects[0].some((n, i) => n !== [box.lo[u], box.lo[v], box.hi[u], box.hi[v]][i])) clippedFaces++;
          for (const r of rects) {
            const from = [], to = [];
            from[u] = r[2]; to[u] = r[0]; from[v] = r[3]; to[v] = r[1];
            // A tiny hidden depth avoids degenerate cubes in exporters; only
            // the boundary face is enabled. All three dimensions stay negative.
            const depth = Math.min(0.001, thickness / 10);
            from[d.axis] = d.sign > 0 ? p : p + depth;
            to[d.axis] = d.sign > 0 ? p - depth : p;
            output.push({source: box.source.id, from: from.map(round), to: to.map(round), faces: [d.face]});
          }
        }
      }
      if (output.length > 8000) throw new Error('Se generarían demasiadas piezas. Selecciona menos cubos o elige el modo Ligero.');
    }
    return {pieces: output, sourceCount: sources.length, clippedFaces, thickness};
  }
  return {plan, bounds, subtract, transformKey, directions: DIRECTIONS};
}
// Map one vertical two-color ramp across the whole generated outline.
// Outline boxes have inverted dimensions, so their side-face UVs run bottom to top.
function createGradientEngine() {
  const clamp = value => Math.max(0, Math.min(1, value));
  function extent(pieces) {
    return {
      min: Math.min(...pieces.map(piece => Math.min(piece.from[1], piece.to[1]))),
      max: Math.max(...pieces.map(piece => Math.max(piece.from[1], piece.to[1])))
    };
  }
  function factor(y, range) {
    return clamp((range.max - y) / Math.max(range.max - range.min, 1e-8));
  }
  function faceUV(face, piece, range, ramp) {
    const [u0, v0, u1, v1] = ramp;
    const at = y => v0 + (v1 - v0) * factor(y, range);
    if (face === 'up' || face === 'down') {
      const v = at(face === 'up' ? Math.min(piece.from[1], piece.to[1]) : Math.max(piece.from[1], piece.to[1]));
      const margin = Math.min(0.08, (v1 - v0) / 512);
      return [u0, v - margin, u1, v + margin];
    }
    return [u0, at(Math.min(piece.from[1], piece.to[1])), u1, at(Math.max(piece.from[1], piece.to[1]))];
  }
  return {extent, factor, faceUV};
}
// Entity materials live in the resource pack, not in .geo.json or PNG files.
// Build a copy for export; never mutate the input entity or write to its path.
function prepareBedrockEntity(definition, geometryId, texturePath) {
  const copy = JSON.parse(JSON.stringify(definition));
  const description = copy?.['minecraft:client_entity']?.description;
  if (!description || typeof description.identifier !== 'string') {
    throw new Error('Elige el archivo de entidad del resource pack (entity/*.entity.json), no el behavior ni la geometría.');
  }
  function singleSlot(name) {
    const entries = description[name];
    if (!entries || typeof entries !== 'object' || Array.isArray(entries) || Object.keys(entries).length !== 1 ||
        typeof Object.values(entries)[0] !== 'string') {
      throw new Error('La exportación guiada admite entidades con una geometría, una textura y un material. Esta entidad necesita una configuración específica.');
    }
    return Object.keys(entries)[0];
  }
  const geometrySlot = singleSlot('geometry');
  const textureSlot = singleSlot('textures');
  const materialSlot = singleSlot('materials');
  const before = description.materials[materialSlot];
  const replacements = new Map([
    ['entity_emissive_alpha', 'entity_emissive_alpha_one_sided'],
    ['entity_emissive_alpha_one_sided', 'entity_emissive_alpha_one_sided'],
    ['entity_alphatest', 'entity_alphatest_one_sided'],
    ['entity_alphatest_one_sided', 'entity_alphatest_one_sided']
  ]);
  const after = replacements.get(before);
  if (!after) {
    throw new Error(`El material «${before}» no tiene una conversión automática comprobada. Se conserva tu archivo; no se ha exportado una sustitución.`);
  }
  if (!/^geometry\.[a-z0-9_.-]+$/.test(geometryId) || !/^textures\/[a-z0-9_/-]+$/.test(texturePath) || texturePath.split('/').includes('..')) {
    throw new Error('La ruta de recursos generada no es válida.');
  }
  description.materials[materialSlot] = after;
  description.geometry[geometrySlot] = geometryId;
  description.textures[textureSlot] = texturePath;
  return {definition: copy, before, after, identifier: description.identifier};
}
const engine = createOutlineEngine();
const gradientEngine = createGradientEngine();
const ID = 'easy_outline';
const META = 'easy_outline_data';
const actions = [], properties = [];
let style, dialog, preview, previewTimer;
let hiddenMeshes = [];
let sessionOptions = {preset: 'normal', thickness: 0.25, color: '#ffffff', colorMode: 'solid',
  gradientTop: '#ffffff', gradientBottom: '#398dff', clean: false};
const presets = {fine: 0.10, normal: 0.25, bold: 0.5};
const supported = () => !!Project && ['bedrock', 'bedrock_block', 'java_block', 'free'].includes(Format.id);
const isOutline = cube => cube[META]?.kind === 'outline';
const isSource = cube => cube[META]?.kind === 'source';
const own = texture => texture[META]?.kind === 'color';
function message(text) { Blockbench.showQuickMessage(text, 4000); }
function error(err) {
  console.error('[Easy Outline]', err);
  Blockbench.showMessageBox({title: 'Easy Outline', icon: 'info', message: err.message || String(err)});
}
function visible(cube) {
  if (cube.visibility === false || cube.export === false) return false;
  for (let p = cube.parent; p && p !== 'root'; p = p.parent) {
    if (p.visibility === false || p.export === false) return false;
  }
  return true;
}
function selectedCubes() {
  const result = new Set(Cube.selected);
  const groups = typeof Group.multi_selected !== 'undefined' ? Group.multi_selected : (Group.selected ? [Group.selected] : []);
  for (const cube of Cube.all) {
    for (let p = cube.parent; p && p !== 'root'; p = p.parent) {
      if (groups.includes(p) || p.selected) { result.add(cube); break; }
    }
  }
  return [...result];
}
function resolve(scope) {
  const selected = scope === 'all' ? Cube.all : selectedCubes();
  const ids = new Set(selected.filter(c => !isOutline(c)).map(c => c.uuid));
  const batches = new Set(selected.filter(c => c[META]?.batch).map(c => c[META].batch));
  // A cleaned shell is a single operation: updating one member recomputes the
  // whole batch, including sources whose surfaces were completely occluded.
  for (const c of Cube.all) if (isSource(c) && batches.has(c[META].batch)) ids.add(c.uuid);
  const sources = Cube.all.filter(c => !isOutline(c) && ids.has(c.uuid) && visible(c));
  const old = Cube.all.filter(c => isOutline(c) && (scope === 'all' || batches.has(c[META].batch) || ids.has(c[META].source)));
  const tracked = Cube.all.filter(c => isSource(c) && (scope === 'all' || batches.has(c[META].batch) || ids.has(c.uuid)));
  return {sources, old, tracked};
}
function snapshot(c) {
  return {id: c.uuid, from: c.from.slice(), to: c.to.slice(), inflate: c.inflate,
    stretch: c.stretch?.slice(), rotation: c.rotation.slice(), origin: c.origin.slice(),
    rescale: c.rescale, parent: c.parent?.uuid || 'root',
    faces: Object.fromEntries(Object.entries(c.faces).map(([key, face]) => [key, face.texture !== null]))};
}
function getOptions(data) {
  const color = typeof data.color === 'string' ? data.color : data.color?.toHexString?.();
  const gradientTop = typeof data.gradientTop === 'string' ? data.gradientTop : data.gradientTop?.toHexString?.();
  const gradientBottom = typeof data.gradientBottom === 'string' ? data.gradientBottom : data.gradientBottom?.toHexString?.();
  const colorMode = data.colorMode === 'gradient' ? 'gradient' : 'solid';
  if (colorMode === 'solid' && !/^#[0-9a-f]{6}$/i.test(color || '')) {
    throw new Error('Elige un color válido de seis dígitos, por ejemplo #ffffff.');
  }
  if (colorMode === 'gradient' && (!/^#[0-9a-f]{6}$/i.test(gradientTop || '') || !/^#[0-9a-f]{6}$/i.test(gradientBottom || ''))) {
    throw new Error('El degradado necesita dos colores HEX válidos de seis dígitos.');
  }
  return {scope: data.scope === 'selection' ? 'selection' : 'all',
    color: /^#[0-9a-f]{6}$/i.test(color || '') ? color.toLowerCase() : '#ffffff',
    colorMode, gradientTop: (gradientTop || '#ffffff').toLowerCase(), gradientBottom: (gradientBottom || '#398dff').toLowerCase(),
    thickness: Number(data.thickness), clean: !!data.clean, preset: data.preset || 'custom'};
}
function prepare(data) {
  if (!supported()) throw new Error('Abre un modelo Generic Model, Bedrock Entity, Bedrock Block o Java Block/Item.');
  if (Format.single_texture || Format.single_texture_default) validateAtlasTextures();
  const options = getOptions(data);
  const target = resolve(options.scope);
  const plan = engine.plan(target.sources.map(snapshot), options);
  if (Format.id === 'java_block' && Format.cube_size_limiter && plan.pieces.some(p => [...p.from, ...p.to].some(n => n < -16 || n > 32))) {
    throw new Error('El contorno supera el espacio disponible de este formato Java (−16 a 32). Reduce el grosor o mueve el modelo hacia el centro.');
  }
  return {...target, options, plan};
}
function clearPreview() {
  clearTimeout(previewTimer);
  if (preview) {
    preview.parent?.remove(preview);
    preview.traverse(obj => { if (obj.geometry) obj.geometry.dispose(); });
    preview.userData.material?.dispose();
    preview = null;
  }
  for (const [mesh, value] of hiddenMeshes) mesh.visible = value;
  hiddenMeshes = [];
}
function showPreview(data) {
  clearPreview();
  const result = prepare(data);
  if (result.plan.pieces.length > 2500) return {...result, pausedPreview: true};
  const gradient = result.options.colorMode === 'gradient';
  const material = new THREE.MeshBasicMaterial({color: gradient ? '#ffffff' : result.options.color,
    vertexColors: gradient, side: THREE.FrontSide});
  preview = new THREE.Group();
  preview.name = 'easy_outline_preview';
  preview.userData.material = material;
  Canvas.scene.add(preview);
  Canvas.scene.updateMatrixWorld(true);
  const sceneInverse = new THREE.Matrix4().copy(Canvas.scene.matrixWorld).invert();
  const sources = new Map(result.sources.map(c => [c.uuid, c]));
  const range = gradient ? gradientEngine.extent(result.plan.pieces) : null;
  const topColor = gradient ? new THREE.Color(result.options.gradientTop) : null;
  const bottomColor = gradient ? new THREE.Color(result.options.gradientBottom) : null;
  const faceOrder = ['east', 'west', 'up', 'down', 'south', 'north'];
  for (const piece of result.plan.pieces) {
    const source = sources.get(piece.source);
    const geometry = new THREE.BoxGeometry(...piece.to.map((v, a) => v - piece.from[a]));
    geometry.translate(...piece.from.map((v, a) => (v + piece.to[a]) / 2 - source.origin[a]));
    if (gradient) {
      const position = geometry.attributes.position;
      const colors = new Float32Array(position.count * 3);
      for (let i = 0; i < position.count; i++) {
        const t = gradientEngine.factor(position.getY(i) + source.origin[1], range);
        const color = topColor.clone().lerp(bottomColor, t);
        colors.set([color.r, color.g, color.b], i * 3);
      }
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    }
    const indices = [];
    geometry.groups.forEach((group, i) => {
      if (piece.faces.includes(faceOrder[i])) indices.push(...Array.from(geometry.index.array.slice(group.start, group.start + group.count)));
    });
    geometry.clearGroups();
    geometry.setIndex(indices);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.multiplyMatrices(sceneInverse, source.mesh.matrixWorld);
    preview.add(mesh);
  }
  for (const c of result.old) if (c.mesh) { hiddenMeshes.push([c.mesh, c.mesh.visible]); c.mesh.visible = false; }
  return result;
}
function schedulePreview(data, view) {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    if (!dialog || !Project) return;
    try {
      const result = data.preview ? showPreview(data) : (clearPreview(), prepare(data));
      view.problem = '';
      view.count = result.sources.length;
      view.pieces = result.plan.pieces.length;
      view.faces = result.plan.pieces.reduce((sum, piece) => sum + piece.faces.length, 0);
      view.cleaned = result.plan.clippedFaces;
      view.previewPaused = !!result.pausedPreview;
    } catch (e) {
      clearPreview();
      view.problem = e.message;
      view.count = 0; view.pieces = 0; view.faces = 0; view.cleaned = 0;
    }
  }, 120);
}
function refreshSelectionPreview() {
  const view = dialog?.content_vue;
  if (view?.options.scope === 'selection') schedulePreview(view.options, view);
}
function closeDialogOnProjectChange() {
  if (dialog) dialog.cancel();
  else clearPreview();
}
// Prepare PNGs before opening an Undo transaction. Source images are copied
// pixel-for-pixel; their UV coordinates never move or get rescaled.
function validateAtlasTextures() {
  const textures = Texture.all.slice();
  if (!textures.length) throw new Error('Añade primero la textura del modelo. Easy Outline reservará el color del borde automáticamente.');
  if (textures.some(t => t.error || !t.width || !t.height || !t.img.complete)) throw new Error('Espera a que termine de cargar la textura del modelo.');
  if (textures.some(t => t.frameCount > 1)) {
    throw new Error('La textura tiene varios fotogramas de animación. Esta versión necesita una textura estática para ampliar el atlas.');
  }
  // render_mode describes compositing multiple texture files. It does not
  // indicate animation or editable image layers inside a single texture.
  if (textures.length > 1 && textures.some(t => t.render_mode === 'layered')) {
    throw new Error('El modelo superpone varios archivos de textura. Usa una textura compuesta para crear el contorno; las capas editables dentro de una sola textura sí son compatibles.');
  }
  if (textures.some(t => t.width !== textures[0].width || t.height !== textures[0].height)) {
    throw new Error('Las variantes de textura deben tener el mismo tamaño para reservar un color sin alterar sus UV.');
  }
  return textures;
}
function prepareColor(color) {
  const single = Format.single_texture || Format.single_texture_default;
  if (!single) {
    const existing = Texture.all.find(t => own(t) && t[META].color === color);
    if (existing) return {kind: 'existing', texture: existing, uv: [4, 4, 12, 12]};
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 16;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, 16, 16);
    return {kind: 'new', data: canvas.toDataURL(), color, uv: [4, 4, 12, 12]};
  }
  const textures = validateAtlasTextures();
  const first = textures[0];
  const pixelX = first.width / Project.texture_width, pixelY = first.height / Project.texture_height;
  const meta = first[META];
  // An atlas row has room for many colors. Reuse it only if its dimensions and
  // UV resolution are still exactly those recorded by the plugin.
  const compatible = meta?.kind === 'atlas' && meta.width === first.width && meta.height === first.height &&
    meta.uvWidth === Project.texture_width && meta.uvHeight === Project.texture_height &&
    textures.every(t => JSON.stringify(t[META]?.slots) === JSON.stringify(meta.slots));
  const slot = compatible && meta.slots?.[color];
  if (slot) {
    const wanted = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
    const intact = textures.every(t => {
      const pixel = t.ctx.getImageData(Math.floor(slot[0] * pixelX), Math.floor(slot[1] * pixelY), 1, 1).data;
      return pixel[3] === 255 && wanted.every((v, i) => v === pixel[i]);
    });
    if (intact) return {kind: 'atlas-existing', textures, uv: slot};
  }
  if (Cube.all.filter(c => !isOutline(c)).some(c => Object.values(c.faces).some(f => f.texture !== null &&
      f.uv.some((v, i) => v < -1e-6 || v > (i % 2 ? Project.texture_height : Project.texture_width) + 1e-6)))) {
    throw new Error('Hay UV fuera de la textura. Colócalas dentro del lienzo antes de añadir la franja de color para conservar su apariencia.');
  }
  const index = compatible ? Object.keys(meta.slots).length : 0;
  const capacity = Math.floor(first.width / 4);
  const reuse = compatible && index < capacity;
  const x = reuse ? index * 4 : 0;
  const y = reuse ? meta.row : first.height;
  const width = Math.max(first.width, 4);
  const height = reuse ? first.height : first.height + 4;
  if (width > 8192 || height > 8192) throw new Error('La textura resultante excedería 8192 píxeles. Reduce su tamaño antes de continuar.');
  const uvWidth = width / pixelX, uvHeight = height / pixelY;
  const uv = [(x + 1) / pixelX, (y + 1) / pixelY, (x + 3) / pixelX, (y + 3) / pixelY];
  const changes = textures.map(texture => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(texture.canvas, 0, 0);
    ctx.fillStyle = color; ctx.fillRect(x, y, 4, 4);
    return {texture, data: canvas.toDataURL(), swatch: {x, y, color}, meta: {kind: 'atlas', width, height, uvWidth, uvHeight,
      row: y, originalSides: texture[META]?.originalSides ?? texture.render_sides,
      slots: {...(reuse ? texture[META].slots : {}), [color]: uv}}};
  });
  return {kind: 'atlas', changes, uv, uvWidth, uvHeight};
}
function drawGradient(ctx, x, y, width, height, top, bottom) {
  const ramp = ctx.createLinearGradient(0, y + 2, 0, y + height - 2);
  ramp.addColorStop(0, top);
  ramp.addColorStop(1, bottom);
  ctx.fillStyle = ramp;
  ctx.fillRect(x, y, width, height);
}
function prepareGradient(top, bottom) {
  const key = `${top}:${bottom}`;
  const single = Format.single_texture || Format.single_texture_default;
  if (!single) {
    const existing = Texture.all.find(t => own(t) && t[META].color === key &&
      t.width === 64 && t.height === 64 && !(t.frameCount > 1));
    if (existing) return {kind: 'existing', texture: existing, uv: [4, 0.5, 12, 15.5], gradient: true};
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    drawGradient(canvas.getContext('2d'), 0, 0, 64, 64, top, bottom);
    return {kind: 'new', data: canvas.toDataURL(), color: key,
      name: `easy_outline_gradient_${top.slice(1)}_${bottom.slice(1)}.png`,
      uv: [4, 0.5, 12, 15.5], gradient: true};
  }
  const textures = validateAtlasTextures();
  const first = textures[0];
  const pixelX = first.width / Project.texture_width, pixelY = first.height / Project.texture_height;
  const meta = first[META];
  const compatible = meta?.kind === 'gradient-atlas' && meta.width === first.width && meta.height === first.height &&
    meta.uvWidth === Project.texture_width && meta.uvHeight === Project.texture_height &&
    textures.every(t => JSON.stringify(t[META]?.gradientSlots) === JSON.stringify(meta.gradientSlots));
  const slot = compatible && meta.gradientSlots?.[key];
  if (slot) {
    const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const intact = textures.every(t => {
      const firstPixel = t.ctx.getImageData(slot.pixel[0] + 1, slot.pixel[1], 1, 1).data;
      const lastPixel = t.ctx.getImageData(slot.pixel[0] + 1, slot.pixel[1] + 67, 1, 1).data;
      return firstPixel[3] === 255 && lastPixel[3] === 255 &&
        rgb(top).every((value, i) => firstPixel[i] === value) &&
        rgb(bottom).every((value, i) => lastPixel[i] === value);
    });
    if (intact) return {kind: 'gradient-atlas-existing', textures, uv: slot.uv, gradient: true};
  }
  if (Cube.all.filter(c => !isOutline(c)).some(c => Object.values(c.faces).some(f => f.texture !== null &&
      f.uv.some((v, i) => v < -1e-6 || v > (i % 2 ? Project.texture_height : Project.texture_width) + 1e-6)))) {
    throw new Error('Hay UV fuera de la textura. Colócalas dentro del lienzo antes de añadir el degradado.');
  }
  const existingSlots = compatible ? Object.values(meta.gradientSlots || {}) : [];
  const index = existingSlots.reduce((n, entry) => Math.max(n, Math.floor(entry.pixel[0] / 4) + 1), 0);
  const width = Math.max(first.width, 4);
  const reuse = compatible && index < Math.floor(width / 4);
  const x = reuse ? index * 4 : 0;
  const y = reuse ? meta.row : first.height;
  const height = reuse ? first.height : first.height + 68;
  if (width > 8192 || height > 8192) throw new Error('La textura resultante excedería 8192 píxeles. Reduce su tamaño antes de continuar.');
  const uvWidth = width / pixelX, uvHeight = height / pixelY;
  const uv = [(x + 1) / pixelX, (y + 2) / pixelY, (x + 3) / pixelX, (y + 66) / pixelY];
  const changes = textures.map(texture => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(texture.canvas, 0, 0);
    drawGradient(ctx, x, y, 4, 68, top, bottom);
    return {texture, data: canvas.toDataURL(), swatch: {x, y, top, bottom},
      meta: {kind: 'gradient-atlas', width, height, uvWidth, uvHeight, row: y,
        originalSides: texture[META]?.originalSides ?? texture.render_sides,
        gradientSlots: {...(reuse ? texture[META].gradientSlots : {}), [key]: {pixel: [x, y], uv}}}};
  });
  return {kind: 'gradient-atlas', changes, uv, uvWidth, uvHeight, gradient: true};
}
function preparePaint(options) {
  return options.colorMode === 'gradient'
    ? prepareGradient(options.gradientTop, options.gradientBottom) : prepareColor(options.color);
}
function applyColor(prepared, trackedTextures) {
  if (prepared.kind === 'existing') return prepared.texture;
  if (prepared.kind === 'new') {
    const texture = new Texture({name: prepared.name || `easy_outline_${prepared.color.slice(1)}.png`, folder: 'block',
      namespace: 'minecraft', render_sides: 'front', keep_size: true});
    texture[META] = {kind: 'color', color: prepared.color};
    texture.fromDataURL(prepared.data).add(false);
    trackedTextures.push(texture);
    return texture;
  }
  if (prepared.kind === 'atlas' || prepared.kind === 'gradient-atlas') {
    Project.texture_width = prepared.uvWidth;
    Project.texture_height = prepared.uvHeight;
    for (const change of prepared.changes) {
      change.texture[META] = change.meta;
      change.texture.keep_size = true;
      change.texture.render_sides = 'front';
      if (change.texture.layers_enabled) {
        // Preserve all original layers (including hidden ones, blend modes,
        // offsets and the active selection). Append only the reserved swatch.
        const layer = new TextureLayer({name: change.swatch.color ? `Easy Outline ${change.swatch.color}` : 'Easy Outline degradado',
          offset: [change.swatch.x, change.swatch.y], visible: true, opacity: 100,
          blend_mode: 'default'}, change.texture);
        layer.setSize(4, change.swatch.color ? 4 : 68);
        if (change.swatch.color) {
          layer.ctx.fillStyle = change.swatch.color;
          layer.ctx.fillRect(0, 0, 4, 4);
        } else {
          drawGradient(layer.ctx, 0, 0, 4, 68, change.swatch.top, change.swatch.bottom);
        }
        change.texture.layers.push(layer);
        change.texture.width = change.meta.width;
        change.texture.height = change.meta.height;
        change.texture.updateLayerChanges(true);
        change.texture.saved = false;
      } else {
        change.texture.fromDataURL(change.data);
      }
      change.texture.updateMaterial();
    }
  } else {
    for (const texture of prepared.textures) { texture.render_sides = 'front'; texture.updateMaterial(); }
  }
  return Texture.getDefault() || Texture.all[0];
}
function cleanupColors() {
  const used = new Set();
  for (const element of Outliner.elements) {
    for (const face of Object.values(element.faces || {})) if (face.texture) used.add(face.texture);
  }
  for (const texture of Texture.all.slice()) {
    if (own(texture) && !used.has(texture.uuid)) texture.remove(true);
    if (['atlas', 'gradient-atlas'].includes(texture[META]?.kind) && !Cube.all.some(isOutline)) {
      texture.render_sides = texture[META].originalSides || 'auto';
      texture.updateMaterial();
    }
  }
}
function apply(data) {
  clearPreview();
  const result = prepare(data);
  const color = preparePaint(result.options);
  const elements = [...new Set([...result.sources, ...result.old, ...result.tracked])];
  const textures = Texture.all.slice();
  Undo.initEdit({elements, textures, bitmap: true, uv_mode: true, outliner: true, selection: true});
  try {
    const texture = applyColor(color, textures);
    const batch = guid();
    const byId = new Map(result.sources.map(c => [c.uuid, c]));
    const range = color.gradient ? gradientEngine.extent(result.plan.pieces) : null;
    result.old.forEach(c => c.remove());
    result.tracked.forEach(c => { c[META] = {}; });
    for (const c of result.sources) c[META] = {kind: 'source', batch, options: result.options};
    for (const piece of result.plan.pieces) {
      const source = byId.get(piece.source);
      const faces = Object.fromEntries(Object.keys(source.faces).map(face => [face,
        {uv: color.gradient ? gradientEngine.faceUV(face, piece, range, color.uv) : color.uv.slice(),
          texture: piece.faces.includes(face) ? texture.uuid : null, cullface: '', tint: -1}]));
      const cube = new Cube({name: `EO_${source.name}`, from: piece.from, to: piece.to,
        origin: source.origin.slice(), rotation: source.rotation.slice(), rescale: source.rescale,
        box_uv: false, autouv: 0, inflate: 0, shade: false, faces,
        [META]: {kind: 'outline', batch, source: source.uuid}});
      cube.addTo(source.parent).init();
      elements.push(cube);
    }
    cleanupColors();
    Canvas.updateAll();
    Undo.finishEdit('Easy Outline: crear / actualizar', {
      elements: elements.filter(c => Cube.all.includes(c)), textures: Texture.all.slice(),
      bitmap: true, uv_mode: true, outliner: true, selection: true
    });
    sessionOptions = {...result.options};
    message(`Contorno listo · ${result.sources.length} cubos · Ctrl+Z para deshacer`);
    return result;
  } catch (e) {
    Undo.cancelEdit(true);
    throw e;
  }
}
function removeOutlines(scope = 'all') {
  clearPreview();
  const {old, tracked} = resolve(scope);
  if (!old.length && !tracked.length) { message('No hay contornos de Easy Outline en este ámbito.'); return; }
  Undo.initEdit({elements: [...old, ...tracked], textures: Texture.all.slice(), bitmap: true, outliner: true, selection: true});
  try {
    old.forEach(c => c.remove());
    tracked.forEach(c => { c[META] = {}; });
    cleanupColors();
    Canvas.updateAll();
    Undo.finishEdit('Easy Outline: quitar contorno', {elements: tracked, textures: Texture.all.slice(), bitmap: true, outliner: true, selection: true});
    message(`Se quitaron ${old.length} piezas de contorno. Los cubos originales se conservan.`);
  } catch (e) { Undo.cancelEdit(true); throw e; }
}
function exportBedrockEntity() {
  if (!Project || Format.id !== 'bedrock') return;
  const project = Project;
  Blockbench.import({type: 'Entidad Bedrock del resource pack', extensions: ['json'], readtype: 'text',
    multiple: false, resource_id: 'easy_outline_entity', title: 'Elegir entidad: se leerá sin modificar el archivo'}, files => {
    if (!files?.length) return;
    if (Project !== project) { error(new Error('El proyecto cambió. Vuelve a iniciar la exportación desde el modelo correcto.')); return; }
    try {
      const definition = autoParseJSON(files[0].content);
      if (!definition) throw new Error('No se pudo leer el JSON de la entidad.');
      exportBundle({definition, name: files[0].name || files[0].path.split(/[\\/]/).pop()}).catch(error);
    } catch (e) { error(e); }
  });
}
async function exportBundle(entityTemplate) {
  if (!supported()) return;
  clearPreview();
  const cleanName = name => String(name).toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'modelo';
  const name = cleanName(Project.name);
  if (Format.id === 'free') {
    const zip = new JSZip();
    for (const [i, texture] of Texture.all.entries()) {
      if (texture.error || !texture.img.complete) throw new Error('Espera a que todas las texturas terminen de cargar antes de exportar.');
      const filename = cleanName(texture.name.replace(/\.[^.]+$/, ''));
      zip.file(`textures/${name}/${filename}_${i}.png`, texture.getDataURL().split(',')[1], {base64: true});
    }
    zip.file(`${name}.bbmodel`, Codecs.project.compile({bitmaps: true, absolute_paths: false}));
    zip.file('LEEME.txt', [
      'EASY OUTLINE · Generic Model · Por Pavito', '',
      'El archivo .bbmodel conserva el modelo editable y las texturas incrustadas.',
      'La carpeta textures/ incluye copias PNG independientes.',
      'Generic Model no tiene un formato de exportación único para Minecraft.',
      'Si vas a usarlo en un juego, exporta desde Blockbench al formato que necesites y comprueba el material de una sola cara.'
    ].join('\n'));
    const content = await zip.generateAsync({type: 'blob'});
    Blockbench.export({resource_id: 'easy_outline_bundle', type: 'Easy Outline ZIP', extensions: ['zip'],
      name: `${name}_outline`, content, savetype: 'zip'});
    return;
  }
  const java = Format.id === 'java_block';
  const raw = Codecs[java ? 'java_block' : 'bedrock'].compile({raw: true});
  const model = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const zip = new JSZip();
  let entityIntegration;
  const textureName = (texture, i) => `${cleanName(texture.name.replace(/\.[^.]+$/, ''))}_${i}`;
  if (entityTemplate) {
    if (Format.id !== 'bedrock' || Texture.all.length !== 1 || model['minecraft:geometry']?.length !== 1) {
      throw new Error('La exportación de entidad necesita un proyecto Bedrock Entity con una sola textura y geometría.');
    }
    const geometryId = `geometry.easy_outline.${name}`;
    entityIntegration = prepareBedrockEntity(entityTemplate.definition, geometryId,
      `textures/entity/${name}/${textureName(Texture.all[0], 0)}`);
    model['minecraft:geometry'][0].description.identifier = geometryId;
    const filename = cleanName(entityTemplate.name.replace(/\.entity\.json$|\.json$/i, ''));
    zip.file(`entity/${filename}.entity.json`, JSON.stringify(entityIntegration.definition, null, 2));
  }
  for (const [i, texture] of Texture.all.entries()) {
    if (texture.error || !texture.img.complete) throw new Error('Espera a que todas las texturas terminen de cargar antes de exportar.');
    const filename = textureName(texture, i);
    if (java) {
      const resource = `easy_outline:block/${name}/${filename}`;
      const oldLink = texture.javaTextureLink();
      for (const key of Object.keys(model.textures || {})) {
        const entry = model.textures[key];
        if (key === texture.id || (typeof entry === 'string' ? entry : entry.sprite) === oldLink) {
          model.textures[key] = typeof entry === 'object' ? {...entry, sprite: resource} : resource;
        }
      }
      zip.file(`assets/easy_outline/textures/block/${name}/${filename}.png`, texture.getDataURL().split(',')[1], {base64: true});
    } else {
      zip.file(`textures/entity/${name}/${filename}.png`, texture.getDataURL().split(',')[1], {base64: true});
    }
  }
  zip.file(java ? `assets/easy_outline/models/block/${name}.json` : `models/entity/${name}.geo.json`, JSON.stringify(model, null, 2));
  zip.file(`${name}.bbmodel`, Codecs.project.compile());
  const instructions = entityIntegration ? [
    'EASY OUTLINE · Entidad Bedrock · Por Pavito', '',
    `Entidad: ${entityIntegration.identifier}`,
    `Material en la copia exportada: ${entityIntegration.before} → ${entityIntegration.after}`, '',
    'El archivo que elegiste solo se ha leído. No se ha escrito en el pack ni cambiado el material del proyecto.',
    'Este ZIP no es un addon instalable. Usa una copia de tu resource pack para probarlo:',
    '1. Sustituye su archivo de entidad original por el JSON de entity/ incluido aquí. No dejes dos definiciones del mismo identificador.',
    '2. Copia las carpetas models/ y textures/ del ZIP respetando sus rutas. La nueva geometría tiene un identificador propio para no reemplazar otras geometrías.',
    '3. Conserva los behavior packs, animaciones y render controllers de tu addon. El JSON exportado mantiene sus referencias; esos archivos externos no se incluyen.',
    '4. Recarga el resource pack en Minecraft. Exportar solo la .geo.json no aplica el cambio de material.', '',
    'La variante de una sola cara se aplica al material de toda esta entidad. Las láminas originales que dependían de verse por ambos lados pueden cambiar de aspecto.',
    'La geometría y la textura están enlazadas en la copia. La apariencia final debe verificarse en Minecraft; esta exportación no ejecuta el juego.',
    'El .bbmodel incluido conserva la edición del contorno en Blockbench.'
  ] : [
    'EASY OUTLINE · Modelo y texturas', '',
    'Este ZIP contiene los recursos de tu modelo y una copia editable .bbmodel.',
    'No es un pack instalable: no reemplaza el manifest, los controladores ni las definiciones de tu proyecto.',
    java ? 'Java: las referencias de textura del JSON ya apuntan a las rutas incluidas en assets/easy_outline.' :
      'Bedrock: usa la geometría con la textura ampliada incluida; todas las variantes incluyen el color del contorno.',
    'La silueta requiere descartar caras traseras. Si el modelo queda tapado, revisa el material de doble cara de tu juego/addon.',
    'Las texturas del editor configuradas como una sola cara no cambian los materiales del juego.',
    'La compatibilidad del material y del motor debe comprobarse en tu versión de Minecraft.',
    'La exportación del modelo no incluye animaciones, behavior packs ni controladores externos.'
  ];
  zip.file('LEEME.txt', instructions.join('\n'));
  const content = await zip.generateAsync({type: 'blob'});
  Blockbench.export({resource_id: 'easy_outline_bundle', type: 'Easy Outline ZIP', extensions: ['zip'],
    name: `${name}_${entityIntegration ? 'entidad_outline' : 'outline'}`, content, savetype: 'zip'});
}
function help() {
  new Dialog({id: 'easy_outline_help', title: 'Easy Outline · Guía rápida', width: 620,
    lines: [
      '1. Abre un modelo Generic Model, Bedrock Entity, Bedrock Block o Java Block/Item con su textura.',
      '2. Ve a Tools / Objetos → Easy Outline. Elige Nieve, Tinta, Dorado o un color personalizado.',
      '3. Para un degradado, activa Degradado debajo del color y elige los colores de arriba y abajo. También puedes intercambiarlos. Ajusta el grosor y pulsa Crear / actualizar.',
      'Para cambiarlo, abre de nuevo Easy Outline. Para eliminarlo, usa Quitar contorno. Ctrl+Z deshace toda la operación.',
      'El modo Ligero crea una sola pieza EO por cubo original. Es el modo inicial. Para reducir un contorno existente, elige Todo el modelo visible → Ligero → Crear / actualizar: sustituye las piezas anteriores.',
      'El modo Uniones limpias recorta superficies interiores entre cubos alineados del mismo hueso y puede crear más piezas. No une huesos independientes ni rotaciones distintas. El borde sigue el volumen del cubo, no los píxeles transparentes de su textura.',
      'El contador muestra piezas, caras y triángulos añadidos. Menos piezas no siempre significa menos caras: el rendimiento también depende de lo que se dibuja, el material y cuántos modelos hay en pantalla. No se estiman FPS.',
      'Guarda el proyecto .bbmodel para conservar los controles de actualización. Exporta el modelo Y las texturas: en Bedrock el color o degradado se reserva en una franja nueva sin repintar los píxeles originales.',
      'Tools / Objetos → Easy Outline: exportar modelo + texturas reúne los recursos en un ZIP. En Generic Model incluye el .bbmodel y los PNG; es un paquete de recursos, no un addon instalable.',
      'Para una entidad Bedrock, usa Easy Outline: exportar entidad Bedrock y elige su JSON del resource pack. Se exporta una copia enlazada al modelo y a la textura, con el material de una sola cara. No se modifica el archivo que elegiste.',
      'En Minecraft, la silueta requiere un material que descarte caras traseras. Un material de doble cara puede tapar el modelo. La opción del editor no cambia el material de tu addon. Los motores de mods Java y sus formatos no se incluyen en esta versión.',
      'La limpieza y la exportación se comprueban en Blockbench; prueba el modelo en tu versión de Minecraft antes de distribuirlo.'
    ], buttons: ['Entendido'], singleButton: true}).show();
}
function openDialog() {
  if (dialog) { dialog.focus(); return; }
  if (!supported()) { help(); return; }
  clearPreview();
  const picked = selectedCubes();
  const saved = picked.find(isSource)?.[META]?.options || Cube.all.find(isSource)?.[META]?.options;
  const initial = {...sessionOptions, ...saved, scope: picked.length ? 'selection' : 'all', preview: true};
  const isBedrock = Format.id === 'bedrock' || Format.id === 'bedrock_block';
  dialog = new Dialog({id: 'easy_outline_dialog', title: 'Easy Outline', width: 620, darken: false,
    cancel_on_click_outside: false,
    buttons: ['Crear / actualizar', 'Cancelar'],
    component: {
      data() { return {options: initial, count: 0, pieces: 0, faces: 0, cleaned: 0, problem: '', previewPaused: false,
        bedrock: isBedrock, bedrockEntity: Format.id === 'bedrock', generic: Format.id === 'free', showAdvanced: false, swatches: [
          {label: 'Nieve', color: '#ffffff'}, {label: 'Tinta', color: '#171923'},
          {label: 'Dorado', color: '#967342'}, {label: 'Menta', color: '#66e3c4'},
          {label: 'Rosa', color: '#ec8cdb'}]}; },
      mounted() { schedulePreview(this.options, this); },
      watch: {options: {deep: true, handler() { schedulePreview(this.options, this); }}},
      methods: {
        preset(name) { this.options.preset = name; this.options.thickness = presets[name]; },
        custom() { this.options.preset = 'custom'; },
        swapGradient() {
          [this.options.gradientTop, this.options.gradientBottom] =
            [this.options.gradientBottom, this.options.gradientTop];
        },
        remove() { try { removeOutlines(this.options.scope); dialog.hide(); dialog = null; } catch (e) { error(e); } },
        help() { help(); }
      },
      template: `<div class="eo-ui">
        <header class="eo-hero"><div class="eo-brand"><i class="material-icons">border_outer</i></div><h2>Easy Outline</h2></header>
        <div class="eo-scope"><label for="eo-scope"><i class="material-icons">center_focus_strong</i> Aplicar a</label><select id="eo-scope" v-model="options.scope">
          <option value="all">Todo el modelo visible</option><option value="selection">Selección y su contorno asociado</option></select></div>
        <section class="eo-panel"><div class="eo-heading"><i class="material-icons">palette</i><div><h3>1. Color del contorno</h3><p>Elige un color para el modo sólido.</p></div></div>
          <div class="eo-color-layout" :class="{inactive: options.colorMode === 'gradient'}"><div class="eo-colors"><button v-for="s in swatches" :key="s.color" class="eo-swatch" :class="{active: options.colorMode !== 'gradient' && options.color.toLowerCase() === s.color}"
            :aria-pressed="options.colorMode !== 'gradient' && options.color.toLowerCase() === s.color" @click="options.color = s.color"><span :style="{background: s.color}"></span>{{s.label}}</button>
            <label class="eo-custom" title="Elegir otro color"><input type="color" aria-label="Color personalizado" v-model="options.color"><span>Otro</span></label></div>
            <div class="eo-color-editor"><label for="eo-hex">Color personalizado</label><div class="eo-color-editor-row"><div class="eo-color-preview" :style="{background: options.color}"><input type="color" aria-label="Seleccionar color" v-model="options.color"></div>
              <input id="eo-hex" type="text" maxlength="7" v-model="options.color" spellcheck="false" aria-label="Código HEX"></div></div></div></section>
        <section class="eo-panel"><div class="eo-heading"><i class="material-icons">gradient</i><div><h3>2. Degradado</h3><p>Combina dos colores de arriba hacia abajo.</p></div></div>
          <div class="eo-presets eo-color-modes"><button :class="{active: options.colorMode !== 'gradient'}" :aria-pressed="options.colorMode !== 'gradient'" @click="options.colorMode = 'solid'">Color sólido</button>
            <button :class="{active: options.colorMode === 'gradient'}" :aria-pressed="options.colorMode === 'gradient'" @click="options.colorMode = 'gradient'">Degradado</button></div>
          <div class="eo-gradient-settings" v-if="options.colorMode === 'gradient'"><div class="eo-gradient-preview" :style="{background: 'linear-gradient(180deg, ' + options.gradientTop + ', ' + options.gradientBottom + ')'}" aria-label="Vista del degradado"></div>
            <label>Arriba<div><input type="color" aria-label="Color superior del degradado" v-model="options.gradientTop"><input type="text" maxlength="7" aria-label="HEX superior" v-model="options.gradientTop" spellcheck="false"></div></label>
            <button class="eo-swap" title="Intercambiar colores" aria-label="Intercambiar colores" @click="swapGradient"><i class="material-icons">swap_vert</i></button>
            <label>Abajo<div><input type="color" aria-label="Color inferior del degradado" v-model="options.gradientBottom"><input type="text" maxlength="7" aria-label="HEX inferior" v-model="options.gradientBottom" spellcheck="false"></div></label></div></section>
        <section class="eo-panel"><div class="eo-heading"><i class="material-icons">tune</i><div><h3>3. Grosor del contorno</h3><p>Ajusta el grosor del borde según tu estilo.</p></div></div>
          <div class="eo-slider"><input type="range" min="0.025" max="1.5" step="0.025" v-model.number="options.thickness" @input="custom" aria-label="Grosor del contorno"><output>{{Number(options.thickness).toFixed(3)}} u</output></div>
          <div class="eo-presets eo-thickness"><button :class="{active: options.preset === 'fine'}" @click="preset('fine')">Fino <small>Discreto</small></button>
            <button :class="{active: options.preset === 'normal'}" @click="preset('normal')">Normal <small>Equilibrado</small></button>
            <button :class="{active: options.preset === 'bold'}" @click="preset('bold')">Grueso <small>Estilo sticker</small></button></div></section>
        <section class="eo-panel"><div class="eo-heading"><i class="material-icons">view_in_ar</i><div><h3>4. Optimización de piezas</h3><p>Controla la cantidad de piezas del contorno.</p></div></div>
          <div class="eo-presets eo-modes"><button :class="{active: !options.clean}" :aria-pressed="!options.clean" @click="options.clean = false"><i class="material-icons">eco</i>Ligero<small>Menos piezas<br>Más rendimiento</small></button>
            <button :class="{active: options.clean}" :aria-pressed="options.clean" @click="options.clean = true"><i class="material-icons">grid_view</i>Uniones limpias<small>Más piezas<br>Menos líneas interiores</small></button></div>
          <p class="eo-note"><i class="material-icons">info_outline</i>{{options.clean ? 'Recorta superficies interiores entre cubos compatibles. Puede generar muchas piezas.' : 'Una pieza por cubo original. Pueden aparecer líneas interiores en las uniones.'}}</p></section>
        <p class="eo-problem" v-if="problem" role="alert"><i class="material-icons">info</i>{{problem}}</p>
        <p class="eo-format-note" v-else-if="previewPaused">Vista previa pausada por el tamaño del modelo. Puedes crear el contorno igualmente.</p>
        <div class="eo-bottom"><label class="eo-preview"><input type="checkbox" v-model="options.preview"><span>Vista previa en el modelo</span></label>
          <button class="eo-disclosure" :aria-expanded="showAdvanced" @click="showAdvanced = !showAdvanced"><i class="material-icons">settings</i>Opciones adicionales<i class="material-icons">{{showAdvanced ? 'expand_less' : 'expand_more'}}</i></button></div>
        <div class="eo-advanced" v-if="showAdvanced"><label>Grosor exacto <input type="number" min="0.005" max="8" step="0.005" v-model.number="options.thickness" @input="custom"></label>
          <button @click="help">Cómo funciona</button><button @click="remove">Quitar contorno</button></div>
        <p class="eo-format-note" v-if="bedrockEntity">Para verlo en Minecraft, usa «Easy Outline: exportar entidad Bedrock» después de crear.</p>
        <p class="eo-format-note" v-else-if="bedrock">Bedrock Block: el material del bloque debe descartar las caras traseras.</p>
        <p class="eo-format-note" v-else-if="generic">Generic Model: guarda el .bbmodel; puedes exportar una copia con sus PNG.</p>
        <p class="eo-format-note" v-else>Java Block/Item: exporta el modelo junto con la textura del contorno.</p>
        <p class="eo-credit">Por Pavito</p>
      </div>`
    },
    onConfirm() {
      try { apply(dialog.content_vue.options); dialog = null; }
      catch (e) { error(e); return false; }
    },
    onCancel() { clearPreview(); dialog = null; }
  });
  // Dialog normally places an invisible modal blocker over the viewport.
  // Keep Blockbench's dialog buttons/keyboard behavior, but let canvas events through.
  const nativeFocus = dialog.focus;
  dialog.focus = function (...args) {
    const result = nativeFocus.apply(this, args);
    if (Dialog.open === this) document.getElementById('blackout').style.display = 'none';
    return result;
  };
  dialog.show();
  if (window.innerWidth >= 1100) {
    dialog.object.style.left = '20px';
    dialog.object.style.top = '62px';
  }
}
Plugin.register(ID, {
  title: 'Easy Outline', author: 'Pavito', icon: 'icon.png', version: '1.0.8',
  description: 'Contornos automáticos con color sólido o degradado para Minecraft.',
  tags: ['Minecraft: Bedrock Edition', 'Minecraft: Java Edition'], variant: 'both', min_version: '5.0.0',
  onload() {
    properties.push(new Property(Cube, 'object', META, {default: {}, exposed: false}));
    properties.push(new Property(Texture, 'object', META, {default: {}, exposed: false}));
    style = Blockbench.addCSS(`
      #easy_outline_dialog{box-sizing:border-box;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);border:1px solid #67e7f8a8;border-radius:22px;background:radial-gradient(circle at 85% 0%,#175c85a8,transparent 38%),radial-gradient(circle at 0% 56%,#0d53617c,transparent 49%),linear-gradient(145deg,#081824f5,#102b41ed 57%,#071827f7);color:#f3f7ff;box-shadow:0 0 0 3px #34e9f61c,0 0 28px #00eaf05a,0 22px 55px #000b;backdrop-filter:blur(24px) saturate(140%);overflow:hidden}
      #easy_outline_dialog .dialog_handle{height:38px;background:linear-gradient(90deg,#102b3be8,#1a4564a3);border-bottom:1px solid #83d8ef51;color:#eaf9ff;box-shadow:none}
      #easy_outline_dialog .dialog_handle .dialog_title{font-weight:700}
      #easy_outline_dialog .dialog_close_button{color:#e8faff}
      #easy_outline_dialog .dialog_content{padding:0;margin:0;overflow-y:auto;overflow-x:hidden;max-height:calc(100vh - 140px);scrollbar-color:#63dce3a0 transparent}
      #easy_outline_dialog .dialog_bar.button_bar{margin:0;padding:12px 20px 16px;gap:10px;background:linear-gradient(180deg,#0d2639a8,#102e43ef);border-top:1px solid #8fdef64a}
      #easy_outline_dialog .dialog_bar.button_bar button{min-height:40px;padding:7px 18px;border-radius:11px;border:1px solid #8fdcf38c;background:linear-gradient(155deg,#203d59,#10283d);color:#f4faff;box-shadow:inset 0 1px #ffffff3d,0 4px 12px #0004;font-size:13px;font-weight:700}
      #easy_outline_dialog .dialog_bar.button_bar button.confirm_btn{background:linear-gradient(120deg,#b9fff7,#2cead8 70%,#54dafe);border-color:#d4fffc;color:#04232c;box-shadow:0 0 16px #22f0d891,inset 0 1px #fff;font-weight:800}
      #easy_outline_dialog .dialog_bar.button_bar button:hover{filter:brightness(1.13)}
      .eo-ui{box-sizing:border-box;padding:22px 20px 8px;color:#f0f6ff;font-size:13px;line-height:1.35}
      .eo-ui *, .eo-ui *:before, .eo-ui *:after{box-sizing:border-box}
      .eo-ui button{cursor:pointer;height:auto;line-height:normal;min-width:0;font-family:inherit}
      .eo-hero{display:flex;gap:15px;align-items:center;height:auto;min-height:64px;margin:0 0 16px;overflow:visible;white-space:normal;background:none}
      .eo-hero>*{height:auto}
      .eo-brand{width:58px;height:58px;flex:0 0 auto;display:grid;place-items:center;border-radius:16px;color:#56fff1;background:linear-gradient(140deg,#073b45,#071b2f);border:1px solid #82fff6;box-shadow:0 0 15px #08ffe9b6,inset 0 0 15px #22fbdd59}
      .eo-brand i{font-size:34px}.eo-hero h2{margin:0;color:#f7fbff;font-size:29px;line-height:1.02;letter-spacing:-.6px;text-shadow:0 2px 14px #001a33}
      .eo-scope{display:flex;align-items:center;gap:12px;padding:9px 12px;margin-bottom:13px;border:1px solid #7bd3ed73;border-radius:12px;background:#0c2a3ab8;box-shadow:inset 0 1px #ffffff22}.eo-scope label{display:flex;align-items:center;gap:6px;white-space:nowrap;color:#d8effb;font-size:11px;font-weight:700}.eo-scope i{font-size:17px;color:#57eadd}.eo-scope select{min-width:0;flex:1;background:#0a2034;border:1px solid #83cde57c;border-radius:8px;color:#f3f9ff;padding:6px 9px;outline-color:#5affea}
      .eo-panel{padding:14px 16px;margin:0 0 12px;border:1px solid #88def0a8;border-radius:16px;background:linear-gradient(135deg,#0a2534bc,#1946688c 62%,#0b253bb8);box-shadow:inset 0 1px #ffffff3d,0 10px 22px #00111b30}
      .eo-heading{display:flex;align-items:center;gap:12px;margin-bottom:12px}.eo-heading>i{flex:0 0 30px;color:#4cf6e7;font-size:27px;filter:drop-shadow(0 0 6px #23ffe58c)}.eo-heading h3{margin:0;font-size:17px;line-height:1.15;color:#f3f7ff}.eo-heading p{margin:3px 0 0;color:#d3e9f5;font-size:11px}
      .eo-color-layout{display:grid;grid-template-columns:minmax(0,1fr) 176px;gap:10px}.eo-colors{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:4px;padding:5px;border:1px solid #69b5d054;border-radius:12px;background:#061d3090}
      .eo-color-layout.inactive{opacity:.55;pointer-events:none}
      .eo-swatch,.eo-custom{min-width:0;min-height:68px;padding:7px 2px;border:1px solid transparent;border-radius:10px;background:transparent;color:#f1f7ff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;font-size:10px;text-align:center}
      .eo-swatch>span{display:block;width:29px;height:29px;flex:0 0 auto;border:1px solid #e7ffffad;border-radius:50%;box-shadow:inset 0 1px 2px #0005,0 2px 7px #0007}.eo-custom input{width:29px;height:29px;padding:0;border:0;border-radius:50%;overflow:hidden;cursor:pointer;background:conic-gradient(red,yellow,lime,cyan,blue,magenta,red)}
      .eo-ui button.active{border-color:#62fff0;color:#fff;background:linear-gradient(155deg,#0b655e90,#103d54a6);box-shadow:0 0 0 1px #8dfff178,0 0 15px #0bf7df7a,inset 0 1px #d5fffb7a}
      .eo-color-editor{min-width:0;padding:10px;border:1px solid #83d4ee7a;border-radius:12px;background:#21516c70}.eo-color-editor label{font-size:11px}.eo-color-editor-row{display:flex;gap:7px;margin-top:7px}.eo-color-preview{height:32px;min-width:56px;flex:1;border:1px solid #e8ffff85;border-radius:8px;overflow:hidden}.eo-color-preview input{width:100%;height:100%;padding:0;opacity:0;cursor:pointer}.eo-color-editor-row>input{width:79px;min-width:0;padding:5px 6px;background:#092037;border:1px solid #91cce087;border-radius:7px;color:#f6faff;font-size:11px;text-transform:uppercase}
      .eo-gradient-settings{display:flex;align-items:end;gap:9px;margin-top:11px;padding:10px;border:1px solid #72c7de77;border-radius:11px;background:#071d30a8}.eo-gradient-preview{flex:0 0 25px;height:55px;border:1px solid #d0fcff;border-radius:8px;box-shadow:0 0 10px #69eceb58}.eo-gradient-settings label{min-width:0;flex:1;color:#d8eaf5;font-size:11px}.eo-gradient-settings label>div{display:flex;gap:5px;margin-top:5px}.eo-gradient-settings input[type=color]{width:34px;height:30px;flex:0 0 auto;padding:0;border:1px solid #8ddced;border-radius:7px;background:#0b2b42;cursor:pointer}.eo-gradient-settings input[type=text]{width:100%;min-width:0;padding:5px 6px;border:1px solid #83cde2;border-radius:7px;background:#0a2237;color:#fff;font-size:11px;text-transform:uppercase}.eo-swap{width:30px;height:30px;border:1px solid #77c9da;border-radius:8px;background:#17455a;color:#73f8e8}.eo-swap i{font-size:19px}
      .eo-slider{display:flex;align-items:center;gap:12px;margin:4px 0 11px}.eo-slider input[type=range]{min-width:0;flex:1;height:8px;appearance:none;border:1px solid #68bfdb89;border-radius:9px;background:linear-gradient(90deg,#3ee9dd,#23799d 50%,#163958);cursor:pointer}.eo-slider input[type=range]::-webkit-slider-thumb{appearance:none;width:20px;height:20px;border:3px solid #e5fffe;border-radius:50%;background:#6bfff0;box-shadow:0 0 12px #39fbe6}.eo-slider input[type=range]::-moz-range-thumb{width:16px;height:16px;border:3px solid #e5fffe;border-radius:50%;background:#6bfff0;box-shadow:0 0 12px #39fbe6}.eo-slider output{min-width:66px;padding:7px 8px;text-align:center;background:#20415c;border:1px solid #91d9ee88;border-radius:9px;font-weight:700}
      .eo-presets{display:flex;gap:9px}.eo-presets button{flex:1;padding:10px 8px;border:1px solid #77c4db82;border-radius:11px;background:linear-gradient(145deg,#0a273a9c,#163c57a6);color:#f0f7ff;text-align:center;font-size:13px;font-weight:700;box-shadow:inset 0 1px #ffffff20}.eo-presets small{display:block;margin-top:3px;font-size:10px;line-height:1.25;font-weight:400;color:#d0e7f5}.eo-modes button{min-height:84px}.eo-modes i{display:block;margin-bottom:3px;font-size:23px;color:#5af8e9}.eo-modes button:not(.active) i{color:#c0ddf5}
      .eo-note{display:flex;align-items:flex-start;gap:6px;margin:10px 0 0;font-size:10px;line-height:1.4;color:#d2e9f3}.eo-note i{flex:0 0 auto;font-size:15px;color:#7ceee7}
      .eo-problem{display:flex;gap:8px;align-items:center;padding:10px;margin:0 0 10px;border:1px solid #ffc9869e;border-radius:10px;background:#58321e7c;font-size:11px}.eo-problem i{color:#ffce83}
      .eo-bottom{display:flex;gap:10px;align-items:center}.eo-preview{display:flex;align-items:center;gap:7px;flex:1;cursor:pointer;font-size:11px}.eo-preview input{accent-color:#51eede}.eo-disclosure{display:flex;align-items:center;gap:7px;padding:8px 11px;border:1px solid #7ac9e489;border-radius:10px;background:#12334da8;color:#ecf9ff;font-size:11px}.eo-disclosure i{font-size:17px;color:#61efe4}.eo-disclosure i:last-child{margin-left:5px}
      .eo-advanced{display:flex;align-items:end;gap:9px;padding:11px;margin-top:8px;border:1px solid #78c9df69;border-radius:11px;background:#092639ad}.eo-advanced label{flex:1;font-size:10px}.eo-advanced input{display:block;width:100%;margin-top:4px;padding:5px;background:#102e42;border:1px solid #80d0df;border-radius:6px;color:#fff}.eo-advanced button{padding:7px;border:1px solid #67b8cba0;border-radius:7px;background:#173e50;color:#f2ffff;font-size:10px}
      .eo-format-note{margin:8px 0 0;color:#afd8e8;font-size:10px;line-height:1.35}.eo-credit{margin:5px 0 0;color:#a8d7e2;text-align:right;font-size:10px}
      .eo-ui button:focus-visible,.eo-ui input:focus-visible,.eo-ui select:focus-visible,#easy_outline_dialog .dialog_bar button:focus-visible{outline:2px solid #c7fffb;outline-offset:2px}
      @media(max-width:620px){.eo-color-layout{grid-template-columns:1fr}}
      @media(max-width:430px){.eo-ui{padding:15px 12px 6px}.eo-hero h2{font-size:23px}.eo-brand{width:45px;height:45px}.eo-brand i{font-size:26px}.eo-panel{padding:12px}.eo-colors{gap:1px}.eo-swatch,.eo-custom{font-size:9px}.eo-swatch>span,.eo-custom input{width:24px;height:24px}.eo-bottom{display:block}.eo-disclosure{margin-top:7px}.eo-advanced{flex-wrap:wrap}}
    `);
    actions.push(new Action('easy_outline_open', {name: 'Easy Outline…', icon: 'border_outer',
      description: 'Crear o actualizar un contorno automáticamente', condition: supported, click: openDialog}));
    actions.push(new Action('easy_outline_remove', {name: 'Easy Outline: quitar todos los contornos', icon: 'layers_clear',
      condition: () => supported() && Cube.all.some(isOutline), click() { try { removeOutlines(); } catch (e) { error(e); } }}));
    actions.push(new Action('easy_outline_help', {name: 'Easy Outline: ayuda', icon: 'help_outline', click: help}));
    actions.push(new Action('easy_outline_export', {name: 'Easy Outline: exportar modelo + texturas', icon: 'folder_zip',
      condition: supported, click() { exportBundle().catch(error); }}));
    actions.push(new Action('easy_outline_export_entity', {name: 'Easy Outline: exportar entidad Bedrock', icon: 'inventory_2',
      condition: () => !!Project && Format.id === 'bedrock', click: exportBedrockEntity}));
    actions.forEach(action => MenuBar.addAction(action, 'tools'));
    Blockbench.on('select_project', closeDialogOnProjectChange);
    Blockbench.on('close_project', closeDialogOnProjectChange);
    Blockbench.on('update_selection', refreshSelectionPreview);
  },
  onunload() {
    clearPreview();
    dialog?.hide(); dialog = null;
    actions.splice(0).forEach(a => a.delete());
    properties.splice(0).forEach(p => p.delete());
    style?.delete();
    Blockbench.removeListener('select_project', closeDialogOnProjectChange);
    Blockbench.removeListener('close_project', closeDialogOnProjectChange);
    Blockbench.removeListener('update_selection', refreshSelectionPreview);
  }
});

})();
