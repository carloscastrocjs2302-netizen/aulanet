// =====================================================================
// AULANET · VISTA: FICHA DEL ESTUDIANTE (observaciones)
// =====================================================================

const VistaFichaEstudiante = {
  perfil: null,
  contenedor: null,
  volverA: null, // función para regresar a la vista anterior

  async render(contenedor, perfil, estudiante, volverA) {
    this.perfil = perfil;
    this.contenedor = contenedor;
    this.estudiante = estudiante;
    this.volverA = volverA;

    contenedor.innerHTML = `
      <div class="app-shell">
        <header class="barra-superior">
          <p class="logo-texto-chico"><span class="logo-aula">AULA</span><span class="logo-net">net</span></p>
          <div class="acciones-barra">
            <button id="btnVolverFicha" class="btn-icono" aria-label="Volver"><i class="ti ti-arrow-left" aria-hidden="true"></i></button>
          </div>
        </header>
        <main class="contenido-principal">
          <div class="cabecera-con-boton">
            <div>
              <p class="titulo-seccion">${escapeHtml(estudiante.nombre_completo)}</p>
              <p class="subtitulo-seccion" id="infoFicha">Cargando...</p>
            </div>
            <button id="btnDescargarPdf" class="btn-primario"><i class="ti ti-file-download" aria-hidden="true"></i> Descargar PDF</button>
          </div>

          <div id="listaObservacionesFicha" class="lista-novedades"><p class="texto-muted" style="padding:14px;">Cargando observaciones...</p></div>
        </main>
      </div>`;

    document.getElementById('btnVolverFicha').addEventListener('click', () => this.volverA());
    document.getElementById('btnDescargarPdf').addEventListener('click', () => VistaInformePDF.render(this.contenedor, this.perfil, this.estudiante, () => this.render(contenedor, perfil, estudiante, volverA)));

    await this.cargarObservaciones();
  },

  async cargarObservaciones() {
    try {
      const { data: periodos } = await sb.from('an_periodos').select('id, anio, numero').order('anio', { ascending: false }).order('numero', { ascending: false }).limit(1);
      const periodoActual = periodos?.[0];
      if (!periodoActual) { document.getElementById('infoFicha').textContent = 'Sin periodo activo'; return; }

      const { data: observaciones, error } = await sb
        .from('an_observaciones')
        .select('texto, an_asignaturas(nombre, an_areas(nombre))')
        .eq('estudiante_id', this.estudiante.id)
        .eq('periodo_id', periodoActual.id);
      if (error) throw error;

      this.observacionesCargadas = observaciones || [];
      document.getElementById('infoFicha').textContent = `${periodoActual.numero}º periodo ${periodoActual.anio} · ${this.observacionesCargadas.length} áreas con observación`;

      const contenedorLista = document.getElementById('listaObservacionesFicha');
      if (this.observacionesCargadas.length === 0) {
        contenedorLista.innerHTML = '<p class="texto-muted" style="padding:14px;">Todavía no hay observaciones cargadas para este estudiante en este periodo.</p>';
        return;
      }

      contenedorLista.innerHTML = this.observacionesCargadas.map(o => `
        <div class="bloque-observacion">
          <p class="area-observacion">${escapeHtml(o.an_asignaturas?.an_areas?.nombre || o.an_asignaturas?.nombre || '')}</p>
          <p class="texto-observacion">${escapeHtml(o.texto)}</p>
        </div>`).join('');
    } catch (e) {
      console.error(e);
      document.getElementById('infoFicha').textContent = 'No pudimos cargar las observaciones.';
    }
  },
};
