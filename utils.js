// =====================================================================
// AULANET · UTILIDADES COMPARTIDAS
// =====================================================================

function normalizar(str) {
  return String(str || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim();
}

function iniciales(nombreCompleto) {
  const partes = String(nombreCompleto || '').trim().split(/\s+/);
  if (partes.length === 0) return '??';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

function mostrarError(mensaje, contenedorId) {
  const el = document.getElementById(contenedorId);
  if (!el) { console.error(mensaje); return; }
  el.textContent = mensaje;
  el.style.display = 'block';
}

function ocultarError(contenedorId) {
  const el = document.getElementById(contenedorId);
  if (el) el.style.display = 'none';
}

function mostrarCargando(contenedorId, mostrar) {
  const el = document.getElementById(contenedorId);
  if (!el) return;
  el.style.display = mostrar ? 'flex' : 'none';
}

// Formatea "Sexto A" a partir del texto crudo del curso, si hiciera falta en el futuro
function formatearFecha(fechaISO) {
  if (!fechaISO) return '';
  const d = new Date(fechaISO);
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
}
