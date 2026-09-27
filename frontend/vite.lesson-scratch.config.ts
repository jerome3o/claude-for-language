// Scratch config for local screenshots (worker on 8794, frontend on 5194). Deleted before committing.
import base from './vite.config';

export default {
  ...base,
  server: { ...base.server, port: 5194, strictPort: true, proxy: { '/api': { target: 'http://localhost:8794', changeOrigin: true } } },
};
