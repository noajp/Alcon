// Fade sections in as they scroll into view.
const targets = document.querySelectorAll('.section .wrap > *, .chapter .wrap > *, .usecase .wrap > *, .closing .wrap');
targets.forEach(el => el.classList.add('reveal'));

if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      }
    });
  }, { rootMargin: '0px 0px -10% 0px' });
  targets.forEach(el => io.observe(el));
} else {
  targets.forEach(el => el.classList.add('in'));
}

// Use-case filter tabs.
const filters = document.querySelectorAll('.filters button');
filters.forEach(btn => btn.addEventListener('click', () => {
  filters.forEach(b => { b.classList.toggle('on', b === btn); b.setAttribute('aria-selected', b === btn); });
  const f = btn.dataset.f;
  document.querySelector('.cases').classList.toggle('filtered', f !== 'all');
  document.querySelectorAll('.case').forEach(c => { c.hidden = f !== 'all' && c.dataset.f !== f; });
}));
