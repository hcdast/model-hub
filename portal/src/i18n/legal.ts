import type { Locale } from './messages';

export type LegalDocument = 'terms' | 'privacy';

interface DocumentContent {
  title: string;
  introduction: string;
  sections: { title: string; body: string }[];
}

interface LegalContent {
  navigation: string;
  reviewTitle: string;
  reviewDescription: string;
  backToLogin: string;
  backToHome: string;
  terms: DocumentContent;
  privacy: DocumentContent;
}

// Drafts tailored to Portal features. Confirm the operator, contact, retention,
// provider disclosures, and applicable jurisdiction before publishing final terms.
export const legalContent: Record<Locale, LegalContent> = {
  zh: {
    navigation: '协议与政策',
    reviewTitle: '待确认草案',
    reviewDescription: '本文为 Model Hub 服务拟定的草案，尚未正式生效。运营主体、联系渠道、数据保存期限及第三方处理信息需在正式发布前确认并补充。',
    backToLogin: '返回登录',
    backToHome: '返回首页',
    terms: {
      title: '服务条款',
      introduction: '欢迎使用 Model Hub。本条款拟适用于 Model Hub 门户、API、模型调用、工作流和短剧创作等服务。“您”指服务使用者，“我们”指正式发布时公示的服务运营方。请在使用前阅读服务条款及隐私政策。',
      sections: [
        { title: '服务范围', body: 'Model Hub 提供 AI 模型浏览与调用、可视化工作流、素材与作品管理、模板及创作工具。具体可用功能、模型、额度和访问权限以您使用时的页面展示及有效订单约定为准。使用 API 或第三方模型时，还应遵守适用于该功能的说明和使用要求。' },
        { title: '账号与凭证安全', body: '请提供准确的注册资料并及时更新，妥善保管密码、验证码及 API Key，并对经您授权的账号使用负责。不得冒用他人身份、转借账号从事违规活动或获取他人凭证。发现异常登录、密钥泄露或未授权扣费时，请及时修改或停用相关凭证并联系服务支持。未成年人应在适用法律允许及监护人同意和指导下使用服务。' },
        { title: '合法使用与内容要求', body: '您应确保上传、输入、处理和发布的内容具有合法来源及必要授权，特别是涉及人像、声音、个人信息和受保护作品时。不得利用服务制作或传播违法内容、侵犯隐私或知识产权、实施欺诈或冒充他人、未经同意制作私密影像、侵害未成年人，或实施攻击、恶意自动化及绕过权限、限流或计费控制等行为。' },
        { title: '输入内容与生成结果的权利', body: '您对输入内容原有的权利不因使用服务而转移。为完成您发起的任务，您授权我们在提供服务所必需的范围内处理、存储和向相关服务商传输该内容。生成结果的使用受适用法律、输入内容权利和相应模型条款约束；我们不保证其具备独占性、可获得知识产权保护或不存在第三方权利。公开分享或投稿模板前，请确认有权公开相关内容。' },
        { title: 'AI 结果的局限', body: 'AI 生成结果可能不准确、不完整、不适用或与他人结果相似。您应在发布、商业使用或据此作出决定前进行必要审核，核实事实、授权及适用性。生成内容不替代医疗、法律、财务等专业意见；对可能造成重大影响的用途，应由具备相应能力的人员复核。' },
        { title: '价格、预算与任务计费', body: '付费功能可能消耗钱包余额或按模型、参数和任务用量计费。请在提交前查看价格、估算和预算设置；估算不代表最终结算金额。部分流程含多个独立任务，停止流程或后续任务失败不当然撤销已执行任务的费用。具体扣费、失败结算、充值及退款规则应以正式公示的规则和有效订单约定为准，法律另有规定的从其规定。' },
        { title: '第三方模型与服务', body: '部分功能依赖第三方模型、身份认证、邮件或存储服务，执行任务时可能需要将相关输入发送至对应服务商。第三方的可用性、处理速度、限制及政策可能影响任务结果。我们会在可控范围内提供必要支持，但不承诺所有模型始终可用或每次生成必然成功。请在提交敏感素材前了解相应服务的信息处理规则。' },
        { title: '服务调整与账号限制', body: '我们可能因维护、安全、第三方变更或业务调整更新服务。对影响持续使用的重要变更，应依法或依约提供适当通知。对有合理依据认定的违规、凭证泄露或安全风险，可采取限制调用、暂停相关功能等必要措施，并在可行范围内说明原因和申诉渠道。账号终止后的费用、资料保存和删除应依适用规则处理。' },
        { title: '责任与争议处理', body: '双方应依适用法律和有效约定承担各自责任。本条款不排除法律规定不得排除或限制的权利与责任。发生服务或计费争议时，请保留任务编号、时间及相关记录，通过服务页面公示的支持渠道沟通；适用法律、争议处理机构及运营方信息需在正式版本中明确。' },
        { title: '条款更新与联系', body: '正式条款应标明生效日期，并在发生重要变更时通过适当方式通知您。需要另行同意的事项将依法取得同意。有关账号、费用、内容权利或服务使用的问题，请通过服务页面公示的联系渠道反馈。本草案的运营主体、正式联系信息及生效日期仍待确认。' },
      ],
    },
    privacy: {
      title: '隐私政策',
      introduction: '本政策草案说明 Model Hub 在账号登录、模型调用、工作流及创作功能中涉及的信息类别、使用目的和您的选择。正式政策应以实际启用的功能、服务商和部署情况为依据，并明确负责处理个人信息的运营主体。',
      sections: [
        { title: '账号与身份信息', body: '注册和使用账号涉及邮箱、用户名、头像、邮箱验证状态及账号权限。密码登录使用密码校验信息；Google 或 GitHub 登录及账号关联涉及您授权提供的第三方账号标识、邮箱、名称或头像。我们还处理登录时间、登录 IP 和会话状态，以维护账号及识别异常访问。' },
        { title: '创作、任务与计费信息', body: '提供模型与创作服务需要处理您提交的提示词、文字、图片、音频、视频、工作流参数、生成结果和任务状态。钱包、报价和计费功能还涉及账号关联的余额、用量及交易记录。请仅提交有权处理的内容，避免在提示词或素材中包含与任务无关的个人信息、账号凭证或敏感资料。' },
        { title: '信息的使用目的', body: '上述信息用于创建和管理账号、身份验证、发送验证码、执行与排查任务、保存和展示作品、核对费用、防范滥用及提供支持。启用功能统计时，相关浏览、模板采用或创作操作记录可用于了解功能使用和改进体验。若拟增加超出已告知范围的处理目的，应另行告知，并在依法需要时取得同意。' },
        { title: 'Cookie 与本地存储', body: '门户使用会话 Cookie 维持登录，并使用相关安全标记保护请求；浏览器本地存储用于保存语言偏好等设置。您可通过浏览器管理或清除这些信息，但可能需要重新登录或重新选择偏好。正式版本应列明实际启用的存储类别、用途及有效期，其他非必要追踪功能应按适用要求提供相应选择。' },
        { title: '服务商与第三方处理', body: '为执行请求，相关数据可能提供给所选模型的提供方，以及支持身份认证、邮件发送、存储和基础设施的服务商。应以实现相应功能所需的范围为限，并落实适当的数据保护安排。实际接收方、传输字段、处理地点、保留及训练用途规则需在正式上线前核实并提供明确说明；本草案不对未核实的服务商行为作出保证。' },
        { title: '公开分享与内容披露', body: '您主动公开分享作品、发布社区内容或投稿并发布模板时，相关内容及展示资料可能被其他人查看、使用或保存。请在公开前移除不宜公开的信息，并确认相关人员已授权。为履行适用法律义务或响应有权机关依法提出的要求，也可能需要披露必要信息。' },
        { title: '保存、安全与跨境处理', body: '正式政策应按信息类别明确保存期限或确定期限的标准，并说明账号停用、内容删除、备份及依法留存的处理方式。数据可能因实际部署和服务商所在地而在您所在地区以外处理，相关安排需在启用前确认并依法履行适用义务。我们应采取与风险相适应的访问控制、凭证保护和安全措施，但不能承诺任何系统绝对安全。' },
        { title: '您的选择与个人信息请求', body: '您可通过已有账号设置修改支持编辑的资料、管理 API Key，并决定是否使用第三方登录、提交素材或公开内容。对于访问、更正、删除、撤回同意、注销账号等请求，可通过正式公示的隐私联系渠道提出；我们应在合理验证身份后，按适用法律及实际提供的功能处理，并说明必要限制和对服务的影响。' },
        { title: '未成年人及敏感内容', body: '涉及未成年人的使用与信息处理，应符合适用法律并取得所需的监护人同意。上传人像、声音、健康信息或其他可能涉及敏感个人信息的内容前，请确认必要性及合法授权。如发现未经授权的未成年人信息或其他敏感内容，请通过隐私联系渠道反馈，以便核查和采取适当措施。' },
        { title: '政策更新与联系', body: '正式政策应标明生效日期、运营主体、可用的隐私联系邮箱或其他渠道。发生重要变化时，应提供清晰通知，并在依法需要时重新取得同意。有关信息处理或行使个人信息权利的问题，请通过服务页面公示的联系渠道提出；具体联系信息和保存期限等部署事项需在本草案正式发布前补齐。' },
      ],
    },
  },
  en: {
    navigation: 'Agreements and policies',
    reviewTitle: 'Draft pending review',
    reviewDescription: 'This draft for Model Hub is not yet effective. The operator, contact channels, retention periods, and third-party processing disclosures must be confirmed before final publication.',
    backToLogin: 'Back to sign in',
    backToHome: 'Back to home',
    terms: {
      title: 'Terms of Service',
      introduction: 'Welcome to Model Hub. These draft terms cover the portal, APIs, model calls, workflows, and short drama creation tools. “You” means the user; “we” means the operator identified in the final publication. Please read the terms and Privacy Policy before use.',
      sections: [
        { title: 'Scope of services', body: 'Model Hub provides AI model browsing and execution, visual workflows, media and project management, templates, and creation tools. Available features, models, limits, and permissions depend on the current service interface and valid order terms. Feature instructions and applicable provider requirements also apply when using APIs or third-party models.' },
        { title: 'Accounts and credential security', body: 'Provide accurate registration information and keep it current. Protect passwords, verification codes, and API Keys, and take responsibility for use you authorize. Do not impersonate others, share accounts for prohibited activities, or obtain another person’s credentials. If you notice unauthorized access, exposed keys, or disputed charges, change or disable affected credentials and contact support. Minors may use the service only where permitted by applicable law and with required guardian consent and guidance.' },
        { title: 'Lawful use and content', body: 'You must have lawful grounds and necessary permissions to upload, process, and publish content, especially faces, voices, personal information, and protected works. Do not use the service for unlawful content, privacy or intellectual property infringements, fraud or impersonation, non-consensual intimate imagery, harm to minors, attacks, abusive automation, or bypassing access, rate, or billing controls.' },
        { title: 'Rights in inputs and outputs', body: 'Your existing rights in input content do not transfer merely through use of the service. You authorize processing, storage, and transfer to relevant providers to the extent necessary to fulfill your requests. Use of outputs remains subject to applicable law, input rights, and model terms. We do not guarantee exclusivity, intellectual property protection, or freedom from third-party rights. Confirm publication rights before sharing content or submitting templates.' },
        { title: 'Limitations of AI outputs', body: 'Outputs may be inaccurate, incomplete, unsuitable, or similar to other outputs. Review facts, permissions, and suitability before publishing, using outputs commercially, or making decisions. Generated content does not replace medical, legal, financial, or other professional advice. Uses with significant consequences require review by appropriately qualified people.' },
        { title: 'Prices, budgets, and task billing', body: 'Paid features may consume wallet balances or incur charges based on models, parameters, and usage. Review prices, estimates, and budgets before submission; estimates are not final settlement amounts. Workflows may include separately billed tasks, and stopping a workflow or a later failure does not automatically reverse charges for tasks already executed. Published billing, failure settlement, top-up, refund, and valid order terms apply, subject to applicable law.' },
        { title: 'Third-party models and services', body: 'Some features depend on external model, authentication, email, or storage services and may send relevant inputs to those providers. Provider availability, speed, restrictions, and policies may affect results. We provide support within our control but do not promise uninterrupted model availability or successful generation every time. Review relevant processing rules before submitting sensitive materials.' },
        { title: 'Service changes and account restrictions', body: 'Maintenance, security needs, provider changes, or business adjustments may require service updates. Material changes affecting continued use should receive appropriate notice as required by law or agreement. Reasonably identified violations, exposed credentials, or security risks may require necessary restrictions or suspension, with reasons and a review channel where feasible. Charges, retention, and deletion after termination follow applicable rules.' },
        { title: 'Responsibility and disputes', body: 'Each party is responsible under applicable law and valid agreements. These terms do not exclude rights or liabilities that cannot lawfully be excluded or limited. Retain task identifiers, times, and relevant records when raising service or billing disputes through published support channels. The final version must identify the operator, applicable law, and dispute resolution arrangements.' },
        { title: 'Updates and contact', body: 'Final terms should state their effective date, and material changes should be communicated appropriately. Separate consent will be obtained where legally required. Direct account, billing, content rights, or service questions to the contact channels published by the service. The operator, official contact details, and effective date remain to be confirmed for this draft.' },
      ],
    },
    privacy: {
      title: 'Privacy Policy',
      introduction: 'This draft describes information categories, purposes, and choices associated with Model Hub accounts, model calls, workflows, and creation tools. The final policy must reflect enabled features, providers, and deployment details and identify the operator responsible for personal information.',
      sections: [
        { title: 'Account and identity information', body: 'Accounts involve email addresses, usernames, avatars, email verification status, and permissions. Password sign-in uses password verification information. Google or GitHub sign-in and linking involve authorized provider identifiers, email addresses, names, or avatars. Login times, IP addresses, and session status are also processed for account management and abnormal access detection.' },
        { title: 'Creative content, tasks, and billing', body: 'Model and creation features process submitted prompts, text, images, audio, video, workflow parameters, outputs, and task status. Wallet, quotation, and billing features also involve account balances, usage, and transaction records. Submit only content you are authorized to process and avoid unrelated personal information, credentials, or sensitive materials.' },
        { title: 'Purposes of processing', body: 'Information supports account management, authentication, verification emails, task execution and troubleshooting, project storage and display, billing reconciliation, abuse prevention, and support. Where feature analytics are enabled, browsing, template adoption, or creation events may help understand usage and improve the experience. New purposes outside disclosed scope require further notice and consent where applicable.' },
        { title: 'Cookies and local storage', body: 'Session cookies maintain sign-in, associated security markers protect requests, and browser local storage saves preferences such as language. You can manage or clear them in your browser, which may require signing in or choosing preferences again. The final policy must specify actual storage categories, purposes, and lifetimes. Other non-essential tracking requires choices where applicable.' },
        { title: 'Providers and third-party processing', body: 'Requests may require relevant data to be sent to the chosen model provider and providers supporting authentication, email, storage, or infrastructure. Sharing should be limited to the relevant function and supported by appropriate protection arrangements. Actual recipients, fields, locations, retention, and training-use rules must be verified and clearly disclosed before launch. This draft makes no guarantees about unverified provider practices.' },
        { title: 'Public sharing and disclosure', body: 'Content and display information you publish through sharing, community posts, or approved template submissions may be viewed, used, or saved by others. Remove information unsuitable for publication and obtain necessary permissions first. Necessary disclosures may also be required to comply with applicable legal obligations or lawful requests from competent authorities.' },
        { title: 'Retention, security, and international processing', body: 'The final policy must specify retention periods or criteria by data category and explain account closure, content deletion, backups, and legally required retention. Deployment and provider locations may involve processing outside your region; arrangements must be confirmed and applicable obligations fulfilled before enabling them. Appropriate access controls, credential protection, and security measures should address risks, but no system can be guaranteed absolutely secure.' },
        { title: 'Choices and information requests', body: 'Available account settings let you edit supported profile details and manage API Keys. You can choose whether to use provider sign-in, submit materials, or publish content. Requests for access, correction, deletion, consent withdrawal, or account closure may be submitted through the published privacy contact. Following reasonable identity checks, requests should be handled under applicable law and available features, with necessary limitations and service effects explained.' },
        { title: 'Minors and sensitive content', body: 'Use by minors and processing of their information must comply with applicable law and required guardian consent. Before uploading faces, voices, health information, or other potentially sensitive personal information, confirm necessity and lawful authorization. Report unauthorized information about minors or other sensitive content through the privacy contact for investigation and appropriate action.' },
        { title: 'Policy changes and contact', body: 'The final policy must state its effective date, operator, and a working privacy email address or other contact channel. Material changes require clear notice and renewed consent where applicable. Submit privacy questions or rights requests through contact channels published by the service. Contact details, retention periods, and other deployment matters must be completed before final publication.' },
      ],
    },
  },
  ja: {
    navigation: '規約とポリシー',
    reviewTitle: '確認待ちの草案',
    reviewDescription: '本草案はまだ発効していません。正式公開前に運営者、連絡先、保存期間、外部サービスによる処理の確認と追記が必要です。',
    backToLogin: 'ログインに戻る',
    backToHome: 'ホームに戻る',
    terms: {
      title: '利用規約',
      introduction: 'Model Hub へようこそ。本草案はポータル、API、モデル実行、ワークフロー、ショートドラマ制作などを対象とします。「利用者」はサービスの利用者、「当社」は正式公開時に明示する運営者を指します。利用前に本規約とプライバシーポリシーをお読みください。',
      sections: [
        { title: 'サービスの範囲', body: 'AI モデルの閲覧と実行、ワークフロー、素材と作品の管理、テンプレート、制作ツールを提供します。利用可能な機能、モデル、上限、権限は利用時の表示と有効な注文条件に従います。API や外部モデルの利用には、各機能の説明と適用される提供者の要件も適用されます。' },
        { title: 'アカウントと認証情報', body: '正確な登録情報を提供し、最新の状態に保ってください。パスワード、認証コード、API Key を保護し、許可した利用に責任を持ってください。なりすまし、不正目的のアカウント共有、他者の認証情報の取得は禁止します。不正アクセス、キーの漏えい、不明な請求を発見した場合は、関連する認証情報を変更または無効化し、サポートへ連絡してください。未成年者は適用法令が認める範囲で、必要な保護者の同意と指導の下で利用してください。' },
        { title: '適法な利用とコンテンツ', body: 'アップロード、処理、公開する内容について、特に顔、声、個人情報、保護された作品に必要な権限を確保してください。違法なコンテンツ、権利侵害、詐欺、なりすまし、同意のない私的画像、未成年者への加害、攻撃、不正な自動化、権限や回数制限や課金の回避に利用してはなりません。' },
        { title: '入力と出力の権利', body: '入力内容について利用者が有する権利は、サービスの利用だけで移転しません。依頼した処理に必要な範囲で、当社による処理、保存、関連提供者への転送を許諾するものとします。出力の利用には適用法令、入力の権利、各モデルの条件が適用されます。独占性、知的財産権の保護、第三者の権利の不存在は保証しません。公開共有やテンプレートの投稿前に必要な権利を確認してください。' },
        { title: 'AI 出力の限界', body: '出力には誤り、不完全な内容、不適切な内容、他の出力との類似があり得ます。公開、商用利用、意思決定の前に事実、許諾、適合性を確認してください。生成内容は医療、法律、財務などの専門的な助言を代替しません。重大な影響を伴う用途では、適切な能力を持つ担当者による確認が必要です。' },
        { title: '料金、予算、課金', body: '有料機能はウォレット残高を消費し、モデル、パラメータ、使用量に応じて課金される場合があります。送信前に料金、見積り、予算を確認してください。見積りは最終請求額ではありません。ワークフローには個別に課金されるタスクが含まれ、停止や後続タスクの失敗によって実行済みの料金が自動的に取り消されるわけではありません。課金、失敗時の精算、チャージ、返金は公示された正式ルール、有効な注文条件、適用法令に従います。' },
        { title: '外部モデルとサービス', body: '一部の機能は外部のモデル、認証、メール、ストレージを使用し、関連する入力を送信する場合があります。外部サービスの稼働状況、速度、制限、方針は結果に影響します。当社が管理できる範囲で支援しますが、常時利用可能であることや毎回の生成成功は保証しません。機密性の高い素材を送信する前に関連する処理ルールを確認してください。' },
        { title: 'サービス変更と利用制限', body: '保守、安全対策、提供者の変更、事業上の調整によりサービスを更新する場合があります。継続利用に影響する重要な変更は、法令や契約に従い適切に通知すべきものとします。合理的に認められる違反、認証情報の漏えい、安全上のリスクに対して、必要な制限や停止を行い、可能な範囲で理由と異議申立て窓口を案内します。終了後の料金、保存、削除は適用ルールに従います。' },
        { title: '責任と紛争', body: '双方は適用法令と有効な合意に基づき責任を負います。法令上除外または制限できない権利や責任を除外しません。サービスや請求については、タスク ID、日時、関連記録を保管し、公示された窓口へ連絡してください。正式版では運営者、準拠法、紛争解決手続きを明示する必要があります。' },
        { title: '更新と連絡先', body: '正式な規約には発効日を記載し、重要な変更を適切に通知します。法令上必要な場合は別途同意を取得します。アカウント、料金、コンテンツの権利、利用に関する質問は、サービスに公示された窓口へご連絡ください。本草案の運営者、正式な連絡先、発効日は未確定です。' },
      ],
    },
    privacy: {
      title: 'プライバシーポリシー',
      introduction: '本草案は Model Hub のアカウント、モデル実行、ワークフロー、制作機能に関する情報の種類、利用目的、選択肢を説明します。正式版は実際の機能、提供者、環境を反映し、個人情報の取扱いに責任を負う運営者を明示する必要があります。',
      sections: [
        { title: 'アカウントと本人情報', body: 'アカウントではメールアドレス、ユーザー名、アバター、メール認証状態、権限を扱います。パスワードログインでは認証用情報を使用します。Google や GitHub のログインと連携では、許可された外部アカウント ID、メール、名前、アバターを扱います。管理と異常なアクセスの検出のため、ログイン時刻、IP アドレス、セッション状態も処理します。' },
        { title: '制作、タスク、課金情報', body: 'モデルと制作機能では、送信されたプロンプト、テキスト、画像、音声、動画、ワークフローのパラメータ、出力、タスク状態を処理します。ウォレット、見積り、課金では残高、使用量、取引記録も扱います。権限のある内容のみ送信し、タスクに不要な個人情報、認証情報、機密資料は含めないでください。' },
        { title: '利用目的', body: '情報はアカウント管理、本人認証、認証メール、タスク実行と問題調査、作品の保存と表示、料金の照合、不正防止、サポートに使用します。機能統計が有効な場合、閲覧、テンプレート採用、制作操作の記録を利用状況の把握と改善に使用する場合があります。告知範囲を超える目的には、別途告知と必要な同意が求められます。' },
        { title: 'Cookie とローカルストレージ', body: 'ログインの維持にセッション Cookie、リクエストの保護に安全用の情報、言語設定などにブラウザーのローカルストレージを使用します。ブラウザーで管理や削除ができますが、再ログインや設定の再選択が必要になる場合があります。正式版では実際の種類、目的、有効期間を明示し、不要な追跡機能には適用要件に応じた選択肢を提供する必要があります。' },
        { title: '提供者と外部での処理', body: '依頼の実行には、選択したモデルの提供者や認証、メール、保存、インフラの提供者への関連データの送信が必要になる場合があります。共有は機能に必要な範囲とし、適切な保護措置が必要です。実際の受領者、項目、処理場所、保存、学習利用のルールを公開前に確認し、明示する必要があります。本草案は未確認の外部サービスの運用を保証しません。' },
        { title: '公開共有と開示', body: '作品の共有、コミュニティへの投稿、審査後のテンプレート公開では、内容や表示情報を他者が閲覧、利用、保存する場合があります。公開すべきでない情報を取り除き、必要な許諾を得てください。適用法令上の義務や権限のある機関の適法な要求に応じ、必要な情報を開示する場合もあります。' },
        { title: '保存、安全、国外での処理', body: '正式版では情報別の保存期間または判断基準と、アカウント終了、内容削除、バックアップ、法定保存の扱いを明示する必要があります。環境や提供者の所在地により国外で処理する場合があり、有効化前に確認し適用義務を履行する必要があります。リスクに応じたアクセス管理や認証情報の保護などを講じるべきですが、完全な安全は保証できません。' },
        { title: '選択肢と個人情報の請求', body: '既存の設定から対応するプロフィール項目を編集し、API Key を管理できます。外部ログイン、素材の送信、公開を行うか選択できます。開示、訂正、削除、同意撤回、アカウント終了などは正式に公示するプライバシー窓口へ請求できます。合理的な本人確認後、適用法令と機能に応じて対応し、必要な制限やサービスへの影響を説明すべきものとします。' },
        { title: '未成年者と機微な内容', body: '未成年者の利用と情報処理は適用法令に従い、必要な保護者の同意を得てください。顔、声、健康情報などの機微な個人情報を送信する前に、必要性と適法な権限を確認してください。無断で扱われた未成年者の情報などはプライバシー窓口へ報告し、調査と適切な対応を求めることができます。' },
        { title: '変更と連絡先', body: '正式版には発効日、運営者、有効なプライバシー用メールアドレスなどを明示する必要があります。重要な変更は明確に通知し、必要な場合は改めて同意を取得します。取扱いや権利行使に関する質問は、公示された窓口へご連絡ください。連絡先、保存期間、環境に関する事項は正式公開前に補完する必要があります。' },
      ],
    },
  },
};
