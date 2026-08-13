export class MockSWASClient {
  constructor(options = {}) {
    this.calls = [];
    this.responses = {
      createFirewallRulesWithOptions: {
        body: {
          requestId: 'mock-create-rules-request',
          firewallRuleIds: ['mock-rule-1'],
        },
      },
      listFirewallRulesWithOptions: {
        body: {
          requestId: 'mock-list-request',
          pageNumber: 1,
          pageSize: 10,
          totalCount: 1,
          firewallRules: [
            {
              firewallRuleId: 'mock-rule-1',
              ruleProtocol: 'TCP',
              port: '39080',
              sourceCidrIp: '203.0.113.10/32',
              remark: 'mock rule',
              status: 'Available',
              tags: [{ key: 'purpose', value: 'octobus-test' }],
            },
          ],
        },
      },
      modifyFirewallRuleWithOptions: {
        body: {
          requestId: 'mock-modify-request',
        },
      },
      deleteFirewallRuleWithOptions: {
        body: {
          requestId: 'mock-delete-request',
        },
      },
      deleteFirewallRulesWithOptions: {
        body: {
          requestId: 'mock-delete-rules-request',
        },
      },
      enableFirewallRuleWithOptions: {
        body: {
          requestId: 'mock-enable-request',
        },
      },
      disableFirewallRuleWithOptions: {
        body: {
          requestId: 'mock-disable-request',
        },
      },
      ...(options.responses || {}),
    };
    this.errors = options.errors || {};
  }

  async createFirewallRulesWithOptions(request, runtime) {
    return this.record('createFirewallRulesWithOptions', request, runtime);
  }

  async listFirewallRulesWithOptions(request, runtime) {
    return this.record('listFirewallRulesWithOptions', request, runtime);
  }

  async modifyFirewallRuleWithOptions(request, runtime) {
    return this.record('modifyFirewallRuleWithOptions', request, runtime);
  }

  async deleteFirewallRuleWithOptions(request, runtime) {
    return this.record('deleteFirewallRuleWithOptions', request, runtime);
  }

  async deleteFirewallRulesWithOptions(request, runtime) {
    return this.record('deleteFirewallRulesWithOptions', request, runtime);
  }

  async enableFirewallRuleWithOptions(request, runtime) {
    return this.record('enableFirewallRuleWithOptions', request, runtime);
  }

  async disableFirewallRuleWithOptions(request, runtime) {
    return this.record('disableFirewallRuleWithOptions', request, runtime);
  }

  record(method, request, runtime) {
    this.calls.push({ method, request, runtime });
    if (this.errors[method]) {
      throw this.errors[method];
    }
    return this.responses[method] ?? { body: { requestId: `mock-${method}` } };
  }

  lastCall() {
    return this.calls.at(-1);
  }
}

export const createMockContext = (overrides = {}) => {
  const client = overrides.client || new MockSWASClient(overrides);
  return {
    client,
    ctx: {
      bindings: {
        regionId: 'cn-beijing',
        instanceId: 'mock-instance',
        accessKeyId: 'mock-access-key-id',
        accessKeySecret: 'mock-access-key-secret',
        endpoint: 'swas.cn-hangzhou.aliyuncs.com',
        ...(overrides.bindings || {}),
      },
      config: overrides.config || {},
      secret: overrides.secret || {},
      limits: { timeoutMs: 12_000, ...(overrides.limits || {}) },
      meta: overrides.meta || {},
      ...(Object.prototype.hasOwnProperty.call(overrides, 'req') ? { req: overrides.req } : {}),
      request: overrides.request,
      clientFactory: () => client,
    },
  };
};
