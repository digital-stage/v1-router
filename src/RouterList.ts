import { Router, RouterId } from './model/model.server';

class RouterList {
  private routers: Router[] = [];

  get(): Router[] {
    return this.routers;
  }

  add(router: Router) {
    this.routers.push(router);
  }

  update(change: Partial<Router>) {
    this.routers = this.routers.map((router) => (router._id === change._id ? {
      ...router,
      ...change,
    } : router));
  }

  remove(id: RouterId) {
    this.routers = this.routers.filter((router) => router._id !== id);
  }
}
export default RouterList;
