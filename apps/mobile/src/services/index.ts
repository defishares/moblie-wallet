/**
 * Services 导出
 */

export { chainServiceMgr, formatGrapheneError } from './chainservice_mgr';
// export { storageService } from './storage_service';
export { backgroundService } from './background_service';
export { secureStorageService } from './secure_storage_service';
export { unlockSession, UNLOCK_SESSION_TTL_MS } from './unlock_session';
export { localCacheManager } from './local_cache_mgr';

// 重新导出区块链相关类型（便于向后兼容）
export type {
  TickerData,
  AssetObject,
  AccountObject,
  FullAccountData,
  LimitOrder,
  GlobalProperties,
} from '../types';
