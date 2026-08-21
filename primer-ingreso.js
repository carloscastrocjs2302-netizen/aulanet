// =====================================================================
// AULANET · VISTA: PRIMER INGRESO (cambiar contraseña temporal)
// =====================================================================

const VistaPrimerIngreso = {
  render(contenedor, perfil) {
    contenedor.innerHTML = `
      <div class="pantalla-centrada">
        <div class="tarjeta-login">
          <div class="logo-aulanet">
            <div class="logo-icono"><i class="ti ti-lock" aria-hidden="true"></i></div>
            <p class="titulo-tarjeta">Crea tu contraseña</p>
            <p class="subtitulo-tarjeta">${escapeHtml(perfil.correo)}</p>
          </div>

          <form id="formPrimerIngreso" novalidate>
            <label for="inputNueva">Nueva contraseña</label>
            <input type="password" id="inputNueva" placeholder="Mínimo 8 caracteres" required autocomplete="new-password" />

            <label for="inputConfirmar">Confirmar contraseña</label>
            <input type="password" id="inputConfirmar" placeholder="Repite la contraseña" required autocomplete="new-password" />

            <p id="errorPrimerIngreso" class="mensaje-error" style="display:none;"></p>

            <button type="submit" id="btnPrimerIngreso" class="btn-primario btn-ancho">Crear contraseña y entrar</button>
          </form>
        </div>
      </div>`;

    document.getElementById('formPrimerIngreso').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      ocultarError('errorPrimerIngreso');

      const nueva = document.getElementById('inputNueva').value;
      const confirmar = document.getElementById('inputConfirmar').value;

      if (nueva.length < 8) {
        mostrarError('La contraseña debe tener al menos 8 caracteres.', 'errorPrimerIngreso');
        return;
      }
      if (nueva !== confirmar) {
        mostrarError('Las contraseñas no coinciden.', 'errorPrimerIngreso');
        return;
      }

      const boton = document.getElementById('btnPrimerIngreso');
      boton.disabled = true;
      boton.textContent = 'Guardando...';

      try {
        await Auth.cambiarPasswordYConfirmar(nueva);
        App.decidirVista();
      } catch (e) {
        boton.disabled = false;
        boton.textContent = 'Crear contraseña y entrar';
        mostrarError('No pudimos guardar tu contraseña. Intenta de nuevo.', 'errorPrimerIngreso');
      }
    });
  },
};
