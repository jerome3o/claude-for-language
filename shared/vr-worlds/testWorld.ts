/** A tiny world for the unit tests (not registered anywhere). */
import type { WorldSpec, WorldWord } from './types';

const W = (hanzi: string, pinyin: string, english: string, measure?: string): WorldWord => ({ hanzi, pinyin, english, ...(measure ? { measure } : {}) });

export function testWorld(): WorldSpec {
  return {
    id: 'test_room',
    title_zh: '测试',
    title_en: 'Test room',
    blurb: 'A table, a cup, two apples, a basket and a box.',
    bounds: { min: [-3, 0, -3], max: [3, 3, 3] },
    spawn: { at: [0, 0, 1], yaw: 0 },
    objects: [
      { id: 'table', word: W('桌子', 'zhuōzi', 'table', '张'), material: 'wood', mass: 0, at: [0, 0.375, -1], collider: { box: [1.2, 0.75, 0.8] }, surface: true },
      { id: 'cup', word: W('杯子', 'bēizi', 'cup', '个'), tags: ['dish'], material: 'ceramic', mass: 0.3, at: [1, 0.05, 0], collider: { cylinder: [0.04, 0.1] } },
      { id: 'apple', word: W('苹果', 'píngguǒ', 'apple', '个'), tags: ['fruit'], material: 'food', mass: 0.2, at: [-1, 0.04, 0], collider: { ball: 0.04 } },
      { id: 'apple_2', word: W('苹果', 'píngguǒ', 'apple', '个'), tags: ['fruit'], material: 'food', mass: 0.2, at: [-1.2, 0.04, 0], collider: { ball: 0.04 } },
      {
        id: 'basket', word: W('篮子', 'lánzi', 'basket', '个'), material: 'cloth', mass: 0.5, at: [1.5, 0.1, -1.5], collider: { box: [0.4, 0.2, 0.3] },
        inside: { min: [-0.2, -0.1, -0.15], max: [0.2, 0.25, 0.15] },
      },
      {
        id: 'box', word: W('箱子', 'xiāngzi', 'box', '个'), material: 'wood', mass: 0, at: [-2, 0.3, -2], collider: { box: [0.6, 0.6, 0.6] },
        states: [{
          key: 'lid',
          initial: 'closed',
          values: {
            closed: { verb: W('关上', 'guānshang', 'close'), label: W('关着', 'guānzhe', 'closed') },
            open: { verb: W('打开', 'dǎkāi', 'open'), label: W('开着', 'kāizhe', 'open') },
          },
        }],
      },
    ],
    zones: [{ id: 'door', min: [-3, 0, 2], max: [-2, 2.5, 3] }],
    tasks: [
      { id: 'pick_cup', zh: '拿起杯子。', pinyin: 'Náqǐ bēizi.', en: 'Pick up the cup.', done: { holding: 'cup' } },
      { id: 'cup_on_table', zh: '把杯子放在桌子上。', pinyin: 'Bǎ bēizi fàng zài zhuōzi shang.', en: 'Put the cup on the table.', done: { on: 'cup', surface: 'table' } },
      { id: 'apples_basket', zh: '把两个苹果放进篮子里。', pinyin: 'Bǎ liǎng gè píngguǒ fàngjìn lánzi li.', en: 'Put two apples in the basket.', done: { count_in_zone: '#fruit', zone: 'basket', n: 2 } },
      {
        id: 'open_then_door',
        zh: '先打开箱子，然后走到门口。',
        pinyin: 'Xiān dǎkāi xiāngzi, ránhòu zǒudào ménkǒu.',
        en: 'Open the box, then walk to the door.',
        done: { sequence: [{ state: 'box', key: 'lid', value: 'open' }, { player_in: 'door' }] },
      },
      { id: 'throw', zh: '把杯子扔进篮子里。', pinyin: 'Bǎ bēizi rēngjìn lánzi li.', en: 'Throw the cup into the basket.', done: { thrown_into: 'cup', zone: 'basket' } },
    ],
  };
}
