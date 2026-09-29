// 自動產生（node scripts/wall-sprites.mjs），不要手改。紙偶動畫的角色姿勢圖：public/wall-sprites/<名字>.webp。
// kind：person（單人）、couple（兩人一起）、dog；w × h：圖的大小（px）；ax, ay：腳底錨點（圖上的 px，ay 可以超出圖外——騰空的姿勢）；
// ref：參考身高（圖上的 px；人是站直的身高、狗是站著到耳尖）；pts：道具點 [x, y, 半徑?]（圖上的 px，側面朝右）。
// 版面用 scenes/_puppet.ts 播放。
export type SpriteKind = 'person' | 'couple' | 'dog';
export interface SpriteInfo { kind: SpriteKind; w: number; h: number; ax: number; ay: number; ref: number; pts?: Record<string, number[]> }
export const SPRITES: Record<string, SpriteInfo> = /* DATA */{
  "cp_hug": {"kind":"couple","w":217,"h":607,"ax":101.5,"ay":603.2,"ref":600},
  "cp_walk_1": {"kind":"couple","w":555,"h":590,"ax":262.7,"ay":585.5,"ref":600},
  "cp_walk_2": {"kind":"couple","w":542,"h":602,"ax":266.1,"ay":598.3,"ref":600},
  "cp_waltz_1": {"kind":"couple","w":572,"h":607,"ax":289.1,"ay":603,"ref":600},
  "cp_waltz_2": {"kind":"couple","w":601,"h":604,"ax":296.4,"ay":600.6,"ref":600},
  "cp_waltz_3": {"kind":"couple","w":587,"h":606,"ax":302,"ay":602.6,"ref":600},
  "cp_waltz_4": {"kind":"couple","w":609,"h":591,"ax":274.1,"ay":588,"ref":600},
  "mt_bad_ready": {"kind":"person","w":379,"h":562,"ax":143.6,"ay":558.1,"ref":600,"pts":{"racket":[337.1,51,38.5]}},
  "mt_bad_smash": {"kind":"person","w":365,"h":600,"ax":192.6,"ay":612.2,"ref":600,"pts":{"racket":[222.4,30.4,36.5]}},
  "mt_bad_swing": {"kind":"person","w":374,"h":578,"ax":175.6,"ay":573.9,"ref":600,"pts":{"racket":[339.5,360.6,32.4]}},
  "mt_cheer": {"kind":"person","w":342,"h":607,"ax":173.2,"ay":603.4,"ref":600},
  "mt_idle_front": {"kind":"person","w":194,"h":608,"ax":93,"ay":603,"ref":600},
  "mt_run_1": {"kind":"person","w":374,"h":564,"ax":218.2,"ay":559.7,"ref":600},
  "mt_run_2": {"kind":"person","w":401,"h":567,"ax":247.7,"ay":562.9,"ref":600},
  "mt_walk_1": {"kind":"person","w":319,"h":587,"ax":153.3,"ay":582.8,"ref":600},
  "mt_walk_2": {"kind":"person","w":317,"h":596,"ax":168.3,"ay":592.1,"ref":600},
  "mt_wok_1": {"kind":"person","w":397,"h":587,"ax":134.3,"ay":583.6,"ref":600,"pts":{"wok":[331,293.3,60.8]}},
  "mt_wok_2": {"kind":"person","w":387,"h":602,"ax":141.2,"ay":598.6,"ref":600,"pts":{"wok":[328.2,146.3,60.8]}},
  "pp_ball": {"kind":"dog","w":306,"h":266,"ax":170.3,"ay":262.9,"ref":260,"pts":{"ball":[285.4,96.5,18.9],"mouth":[285.4,96.5]}},
  "pp_beg": {"kind":"dog","w":221,"h":300,"ax":115.9,"ay":296.5,"ref":260},
  "pp_jump": {"kind":"dog","w":293,"h":271,"ax":146.5,"ay":274.4,"ref":260,"pts":{"ball":[272.8,45.5,18.3],"mouth":[264.6,60.5]}},
  "pp_run_1": {"kind":"dog","w":285,"h":208,"ax":156,"ay":204.9,"ref":260,"pts":{"mouth":[263.7,80]}},
  "pp_run_2": {"kind":"dog","w":309,"h":177,"ax":181.9,"ay":173.1,"ref":260,"pts":{"mouth":[286.6,79.7]}},
  "pp_sit": {"kind":"dog","w":220,"h":294,"ax":105.3,"ay":290.4,"ref":260},
  "pp_sleep": {"kind":"dog","w":306,"h":130,"ax":148.9,"ay":126.9,"ref":260},
  "pp_stand": {"kind":"dog","w":302,"h":266,"ax":165.7,"ay":262.9,"ref":260,"pts":{"mouth":[279.9,94.7]}},
  "pp_walk": {"kind":"dog","w":301,"h":249,"ax":165.7,"ay":245.5,"ref":260},
  "qq_ball": {"kind":"dog","w":283,"h":285,"ax":128.9,"ay":281.3,"ref":280,"pts":{"ball":[264.2,97.3,14.7],"mouth":[264.2,97.3]}},
  "qq_beg": {"kind":"dog","w":264,"h":294,"ax":140.6,"ay":290.1,"ref":280,"pts":{"mouth":[203.8,65.4]}},
  "qq_jump": {"kind":"dog","w":273,"h":279,"ax":123,"ay":282.9,"ref":280,"pts":{"ball":[253.9,37.5,17],"mouth":[246.3,53.7]}},
  "qq_run_1": {"kind":"dog","w":292,"h":249,"ax":134.1,"ay":245.3,"ref":280,"pts":{"mouth":[264.2,134.6]}},
  "qq_run_2": {"kind":"dog","w":297,"h":230,"ax":139.1,"ay":226.8,"ref":280,"pts":{"mouth":[269.4,112.6]}},
  "qq_sit": {"kind":"dog","w":215,"h":290,"ax":91.9,"ay":286.3,"ref":280},
  "qq_sleep": {"kind":"dog","w":296,"h":195,"ax":118.9,"ay":191.3,"ref":280},
  "qq_stand": {"kind":"dog","w":286,"h":287,"ax":137.7,"ay":283.1,"ref":280,"pts":{"mouth":[258.9,91.8]}},
  "qq_walk": {"kind":"dog","w":289,"h":273,"ax":128.9,"ay":269.3,"ref":280},
  "xw_bad_ready": {"kind":"person","w":378,"h":585,"ax":156.6,"ay":581.3,"ref":600,"pts":{"racket":[332.8,129.3,39]}},
  "xw_bad_smash": {"kind":"person","w":392,"h":568,"ax":191.9,"ay":608.2,"ref":600,"pts":{"racket":[206,33.2,36.9]}},
  "xw_bad_swing": {"kind":"person","w":408,"h":593,"ax":199.2,"ay":588.7,"ref":600,"pts":{"racket":[378.8,325.4,32.8]}},
  "xw_cheer": {"kind":"person","w":309,"h":608,"ax":152.5,"ay":603.5,"ref":600},
  "xw_idle_front": {"kind":"person","w":206,"h":607,"ax":101.2,"ay":603.1,"ref":600},
  "xw_kneel": {"kind":"person","w":375,"h":558,"ax":174.2,"ay":554.2,"ref":600},
  "xw_plate": {"kind":"person","w":245,"h":616,"ax":60.1,"ay":612.1,"ref":600,"pts":{"plate":[197.4,188,45.1]}},
  "xw_run_1": {"kind":"person","w":396,"h":565,"ax":227.2,"ay":560.8,"ref":600},
  "xw_run_2": {"kind":"person","w":406,"h":571,"ax":218.5,"ay":567,"ref":600},
  "xw_throw_1": {"kind":"person","w":414,"h":575,"ax":174.2,"ay":570.7,"ref":600,"pts":{"ball":[54.6,57.9,14]}},
  "xw_throw_2": {"kind":"person","w":417,"h":496,"ax":184.5,"ay":492.3,"ref":600,"pts":{"ball":[402.6,36.9,12.3]}},
  "xw_walk_1": {"kind":"person","w":321,"h":597,"ax":140.6,"ay":593.6,"ref":600},
  "xw_walk_2": {"kind":"person","w":332,"h":596,"ax":146.7,"ay":592.4,"ref":600}
}/* END */;
/** 素材管線用的校正值（每組基準姿勢的身高與腳底線佔畫布的比例），版面用不到。 */
export const SPRITE_SERIES = /* SERIES */{
  "cp": {"refFrac":0.9736842105263158,"groundFrac":0.9864433811802232,"target":600},
  "cp_waltz": {"refFrac":0.9641927083333334,"groundFrac":0.982421875,"target":600},
  "mt": {"refFrac":0.9641927083333334,"groundFrac":0.9837239583333334,"target":600},
  "pp": {"refFrac":0.8310546875,"groundFrac":0.927734375,"target":260},
  "qq": {"refFrac":0.9326171875,"groundFrac":0.958984375,"target":280},
  "xw": {"refFrac":0.9518229166666666,"groundFrac":0.9739583333333334,"target":600}
}/* END */;
