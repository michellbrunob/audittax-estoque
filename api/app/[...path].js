import { createHandler } from '../_handler.js';

export default createHandler((url) => {
  const value = String(url || '');
  if (value.startsWith('/api/app/')) {
    return `/api/${value.slice('/api/app/'.length)}`;
  }
  if (value.startsWith('/app/')) {
    return `/api/${value.slice('/app/'.length)}`;
  }
  return value.startsWith('/api/') ? value : `/api/${value.replace(/^\/+/, '')}`;
});

