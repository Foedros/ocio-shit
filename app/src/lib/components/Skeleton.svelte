<script>
  // SKELETON SHIMMER editorial (Tanda 1 de motion): placeholder de carga con un barrido
  // DORADO sutil sobre el fondo museo (#0B0A08 vía --surface), no el gris genérico.
  // Un único primitivo para listas (h baja), carátulas (aspect 2:3 vía h/w) y stats (cards).
  // El reduced-motion global de +layout congela el barrido (0.01ms) → placeholder estático.
  let { h = '1rem', w = '100%', r = '10px' } = $props();
</script>

<div class="skel" style="height:{h}; width:{w}; border-radius:{r}" aria-hidden="true"></div>

<style>
  .skel {
    background: linear-gradient(
      100deg,
      var(--surface) 35%,
      color-mix(in srgb, var(--gold) 9%, var(--surface)) 48%,
      color-mix(in srgb, var(--gold) 14%, var(--surface)) 50%,
      color-mix(in srgb, var(--gold) 9%, var(--surface)) 52%,
      var(--surface) 65%
    );
    background-size: 200% 100%;
    border: 1px solid color-mix(in srgb, var(--gold) 7%, var(--line));
    animation: skel-sweep 1.6s ease-in-out infinite;
  }
  @keyframes skel-sweep {
    to {
      background-position: -200% 0;
    }
  }
</style>
