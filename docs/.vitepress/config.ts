import { defineConfig } from 'vitepress';

export default defineConfig({
  lang: 'zh-CN',
  title: 'team-manager',
  description: 'ChatGPT 账号、Workspace、席位和 Codex 凭证管理手册',
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: '使用手册', link: '/guide/' },
      { text: '核心规则', link: '/core/seat-and-credential-model' },
      { text: '开发参考', link: '/dev-spec/data-model' }
    ],
    sidebar: [
      {
        text: '使用手册',
        items: [
          { text: '业务流程总览', link: '/guide/' },
          { text: '账号与 Workspace', link: '/guide/' },
          { text: '账号与 Workspace 运营 SOP', link: '/guide/account-cleanup-and-refresh-sop' },
          { text: 'Team 升级订单维护', link: '/guide/team-order-maintenance' },
          { text: '额度与席位轮转', link: '/guide/quota-and-seats' },
          { text: '新号填充凭证号池', link: '/guide/fill-credential-pool' },
          { text: '状态与排错', link: '/guide/status-and-errors' }
        ]
      },
      {
        text: '核心规则',
        items: [
          { text: '账号、席位与凭证规则', link: '/core/seat-and-credential-model' }
        ]
      },
      {
        text: '开发参考',
        items: [
          { text: '数据模型', link: '/dev-spec/data-model' },
          { text: 'AT 凭证与账单提取', link: '/dev-spec/at-credential-billing' },
          { text: 'Team 升级订单维护', link: '/dev-spec/team-order-maintenance' },
          { text: '凭证 workspace 绑定实验', link: '/dev-spec/codex-workspace-credential-experiment' },
          { text: 'Codex Auth HTTP 抓包', link: '/dev-spec/codex-auth-direct-http-capture' },
          { text: 'ChatGPT backend-api 样本', link: '/dev-spec/chatgpt-backend-api/' }
        ]
      }
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/shellus/team-manager' }
    ],
    search: {
      provider: 'local'
    },
    outline: {
      level: [2, 3],
      label: '本页目录'
    },
    docFooter: {
      prev: '上一页',
      next: '下一页'
    },
    lastUpdated: {
      text: '最后更新',
      formatOptions: {
        dateStyle: 'short',
        timeStyle: 'short'
      }
    }
  }
});
