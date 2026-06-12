import {createViteBundleLoader} from "../build/ViteBundleLoader";
import {Resolver} from "../core/common/resolver";

const devServerStuff = {
  createViteBundleLoader,
  Resolver,
};

export default devServerStuff;

export type DevServerStuff = typeof devServerStuff;
