// =====================================================================
// AULANET · ROUTER
// =====================================================================
// No hay framework de rutas — esto decide qué vista mostrar según el
// estado de sesión y el rol del docente. Cada vista es un objeto con
// un método render(contenedor, perfil) definido en js/views/*.js
// =====================================================================

const App = {
  contenedor: null,

  init() {
    this.contenedor = document.getElementById('app');
    sb.auth.onAuthStateChange((_evento, _sesion) => {
      this.decidirVista();
    });
    this.decidirVista();
  },

  async decidirVista() {
    this.contenedor.innerHTML = '<div class="pantalla-cargando"><div class="spinner"></div></div>';

    let sesion;
    try {
      sesion = await Auth.obtenerSesion();
    } catch (e) {
      console.error(e);
      VistaLogin.render(this.contenedor);
      return;
    }

    if (!sesion) {
      VistaLogin.render(this.contenedor);
      return;
    }

    let perfil;
    try {
      perfil = await Auth.obtenerPerfilCompleto();
    } catch (e) {
      console.error('Error cargando perfil:', e);
      VistaLogin.render(this.contenedor, 'No pudimos cargar tu perfil. Intenta de nuevo.');
      return;
    }

    if (!perfil) {
      VistaLogin.render(this.contenedor);
      return;
    }

    if (!perfil.confirmado) {
      VistaPrimerIngreso.render(this.contenedor, perfil);
      return;
    }

    this.irADashboard(perfil);
  },

  irADashboard(perfil) {
    switch (perfil.rol) {
      case 'director':
      case 'codirector':
        VistaDashboardDirector.render(this.contenedor, perfil);
        break;
      case 'coordinador_area':
        VistaDashboardCoordinadorArea.render(this.contenedor, perfil);
        break;
      default:
        this.contenedor.innerHTML = `
          <div class="pantalla-proximamente">
            <p class="titulo">Hola, ${escapeHtml(perfil.nombre_completo)}</p>
            <p class="subtitulo">Tu panel de "${escapeHtml(perfil.rol)}" está en construcción — vuelve pronto.</p>
            <button id="btnCerrarSesionTemp" class="btn-secundario">Cerrar sesión</button>
          </div>`;
        document.getElementById('btnCerrarSesionTemp').addEventListener('click', () => Auth.cerrarSesion());
    }
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
