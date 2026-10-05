/** 规则引擎严格 API 使用的稳定错误码。 */
export type RuleEngineErrorCode =
  | 'INVALID_TILE'
  | 'INVALID_PHYSICAL_TILE'
  | 'INVALID_RANDOM_VALUE'
  | 'INVALID_SEED'
  | 'INVALID_STATE';

/** 带机器可读错误码的规则引擎输入/状态错误。 */
export class RuleEngineError extends Error {
  readonly code: RuleEngineErrorCode;

  /** 创建规则错误；message 用于日志或界面映射，不应作为程序分支条件。 */
  constructor(code: RuleEngineErrorCode, message: string) {
    super(message);
    this.name = 'RuleEngineError';
    this.code = code;
  }
}

/** 验证逻辑牌种编号；无效时抛出统一规则错误。 */
export function assertTileType(tile: number): asserts tile is import('./types').TileType {
  if (!Number.isInteger(tile) || tile < 0 || tile >= 34)
    throw new RuleEngineError('INVALID_TILE', `Invalid tile type: ${tile}`);
}

/** 验证实体牌编号；无效时抛出统一规则错误。 */
export function assertPhysicalTileId(id: number): asserts id is import('./types').PhysicalTileId {
  if (!Number.isInteger(id) || id < 0 || id >= 136)
    throw new RuleEngineError('INVALID_PHYSICAL_TILE', `Invalid physical tile id: ${id}`);
}
