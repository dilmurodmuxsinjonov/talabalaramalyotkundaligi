const { router, publicRouter } = require('./routes');

module.exports = {
  name: 'amaliyot',
  title: 'Amaliyot kundaligi',
  router,
  publicRouter,
  nav: [
    { href: '/amaliyot', label: 'Amaliyot kundaligi', roles: ['student'] },
    { href: '/amaliyot/xulosa', label: 'Xulosalar kitobchasi', roles: ['student'] },
    { href: '/amaliyot/ustoz', label: 'Amaliyot nazorati', roles: ['teacher', 'dekanat', 'admin'] },
    { href: '/admin/amaliyot/turlar', label: 'Kundalik turlari', roles: ['teacher', 'dekanat', 'admin'] },
  ],
};
