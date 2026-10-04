/** 首页路由：将客户端游戏容器挂载到 App Router 的根路径。 */
import GameClient from "./GameClient";

export default function Home() {
  return <GameClient />;
}
