import { sortableNumericSuffix } from '@/utils/sort';
import { generateZip, downloadFile } from '@/utils/download';
import { ucFirst } from '@/utils/string';
import { eachLimit } from '~/utils/promise';
import { MODE, _EDIT, EDIT_YAML, _FLAGGED } from '@/config/query-params';
import { TO_FRIENDLY } from '@/config/friendly';
import { findBy } from '@/utils/array';

const REMAP_STATE = { disabled: 'inactive' };

const DEFAULT_COLOR = 'warning';
const DEFAULT_ICON = 'x';

const DEFAULT_WAIT_INTERVAL = 1000;
const DEFAULT_WAIT_TMIMEOUT = 30000;

const STATES = {
  active:   { color: 'success', icon: 'dot-open' },
  inactive: { color: 'info', icon: 'dot' },
  error:    { color: 'error', icon: 'error' },
  unknown:  { color: 'warning', icon: 'x' },
};

const SORT_ORDER = {
  error:   1,
  warning: 2,
  info:    3,
  success: 4,
  other:   5,
};

export default {
  _key() {
    const m = this.metadata;

    if ( m ) {
      return m.uid || `${ m.namespace ? `${ m.namespace }:` : '' }${ m.name }`;
    }

    return this.id || Math.random();
  },

  toString() {
    return () => {
      return `[${ this.type }: ${ this.id }]`;
    };
  },

  nameDisplay() {
    return this.metadata.name || this.id;
  },

  nameSort() {
    return sortableNumericSuffix(this.nameDisplay).toLowerCase();
  },

  namespaceNameDisplay() {
    const namespace = this.metadata.namespace;
    const name = this.metadata.name || this.id;

    if ( namespace ) {
      return `${ namespace }/${ name }`;
    }

    return name;
  },

  namespaceNameSort() {
    return sortableNumericSuffix(this.namespaceNameDisplay).toLowerCase();
  },

  stateDisplay() {
    return this._stateDisplay;
  },

  _stateDisplay() {
    const state = this.stateRelevant || 'unknown';

    if ( REMAP_STATE[state] ) {
      return REMAP_STATE[state];
    }

    return state.split(/-/).map(ucFirst).join('-');
  },

  stateColor() {
    if ( this.computed && this.computed.state && this.computed.state.error ) {
      return 'text-error';
    }

    const key = (this.stateRelevant || '').toLowerCase();
    let color;

    if ( STATES[key] && STATES[key].color ) {
      color = this.maybeFn(STATES[key].color);
    }

    if ( !color ) {
      color = DEFAULT_COLOR;
    }

    return `text-${ color }`;
  },

  stateBackground() {
    return this.stateColor.replace('text-', 'bg-');
  },

  stateIcon() {
    const trans = ( this.computed && this.computed.state && this.computed.state.transitioning ) || 'no';

    if ( trans === 'yes' ) {
      return 'icon icon-spinner icon-spin';
    }

    if ( trans === 'error' ) {
      return 'icon icon-error';
    }

    const key = (this.stateRelevant || '').toLowerCase();
    let icon;

    if ( STATES[key] && STATES[key].icon ) {
      icon = this.maybeFn(STATES[key].icon);
    }

    if ( !icon ) {
      icon = DEFAULT_ICON;
    }

    return `icon icon-${ icon }`;
  },

  stateSort() {
    const color = this.stateColor.replace('text-', '');

    return `${ SORT_ORDER[color] || SORT_ORDER['other'] } ${ this.stateRelevant }`;
  },

  // You can override the state by providing your own stateRelevant (and possibly reading _stateRelevant)
  stateRelevant() {
    return this._stateRelevant;
  },

  _stateRelevant() {
    if ( this.computed && this.computed.state && this.computed.state.name ) {
      return this.computed.state.name;
    }

    // @TODO unknown
    return 'active';
  },

  // ------------------------------------------------------------------

  waitForTestFn() {
    return (fn, msg, timeoutMs, intervalMs) => {
      console.log('Wait for', msg);

      if ( !timeoutMs ) {
        timeoutMs = DEFAULT_WAIT_TMIMEOUT;
      }

      if ( !intervalMs ) {
        intervalMs = DEFAULT_WAIT_INTERVAL;
      }

      return new Promise((resolve, reject) => {
        // Do a first check immediately
        if ( fn.apply(this) ) {
          console.log('Wait for', msg, 'done immediately');
          resolve(this);
        }

        const timeout = setTimeout(() => {
          console.log('Wait for', msg, 'timed out');
          clearInterval(interval);
          clearTimeout(timeout);
          reject(new Error(`Failed while: ${ msg }`));
        }, timeoutMs);

        const interval = setInterval(() => {
          if ( fn.apply(this) ) {
            console.log('Wait for', msg, 'done');
            clearInterval(interval);
            clearTimeout(timeout);
            resolve(this);
          } else {
            console.log('Wait for', msg, 'not done yet');
          }
        }, intervalMs);
      });
    };
  },

  waitForState() {
    return (state, timeout, interval) => {
      return this.waitForTestFn(() => {
        return this.stateRelevant === state;
      }, `Wait for state=${ state }`, timeout, interval);
    };
  },

  waitForTransition() {
    return () => {
      return this.waitForTestFn(() => {
        return this.transitioning !== 'yes';
      }, 'Wait for transition completion');
    };
  },

  waitForAction() {
    return (name) => {
      return this.waitForTestFn(() => {
        return this.hasAction(name);
      }, `Wait for action=${ name }`);
    };
  },

  hasCondition() {
    return (condition, withStatus = 'True') => {
      const entry = findBy((this.conditions || []), 'type', condition);

      if ( !entry ) {
        return false;
      }

      if ( !withStatus ) {
        return true;
      }

      return (entry.status || '').toLowerCase() === `${ withStatus }`.toLowerCase();
    };
  },

  waitForCondition() {
    return (name, withStatus = 'True') => {
      return this.waitForTestFn(() => {
        return this.hasCondition(name, status);
      }, `Wait for condition=${ name }, status=${ status }`);
    };
  },

  // ------------------------------------------------------------------

  // You can add custom actions by overriding your own availableActions (and probably reading _availableActions)
  availableActions() {
    return this._availableActions;
  },

  _availableActions() {
    const all = [];
    const links = this.links || {};
    const friendly = TO_FRIENDLY[this.type.replace(/^rio-/i, '')];

    all.push({
      action:  'goToEdit',
      label:   'Edit',
      icon:    'icon icon-fw icon-edit',
      enabled:  !!links.update,
    });

    if ( friendly ) {
      all.push({
        action:  'viewEditYaml',
        label:   (links.update ? 'View/Edit YAML' : 'View YAML'),
        icon:    'icon icon-file',
        enabled:  !!links.view,
      });
    }

    all.push({ divider: true });

    all.push({
      action:     'download',
      label:      'Download',
      icon:       'icon icon-fw icon-download',
      enabled:    !!links.view,
      bulkable:   true,
      bulkAction: 'downloadBulk',
    });

    all.push({
      action:  'viewInApi',
      label:   'View in API',
      icon:    'icon icon-fw icon-external-link',
      enabled:  !!links.self,
    });

    all.push({ divider: true });

    all.push({
      action:    'promptRemove',
      altAction: 'remove',
      label:     'Delete',
      icon:      'icon icon-fw icon-trash',
      bulkable:  true,
      enabled:   !!links.view,
    });

    // Remove disabled items and consecutive dividers
    let last = null;
    const out = all.filter((item) => {
      if ( item.enabled === false ) {
        return false;
      }

      const cur = item.divider;
      const ok = !cur || (cur && !last);

      last = cur;

      return ok;
    });

    // Remove dividers at the beginning
    while ( out.length && out[0].divider ) {
      out.shift();
    }

    // Remove dividers at the end
    while ( out.length && out[out.length - 1].divider ) {
      out.pop();
    }

    return out;
  },

  maybeFn() {
    return (val) => {
      if ( typeof val === 'function' ) {
        return val(this);
      }

      return val;
    };
  },

  // ------------------------------------------------------------------

  hasLink() {
    return (linkName) => {
      return !!this.linkFor(linkName);
    };
  },

  linkFor() {
    return (linkName) => {
      return (this.links || {})[linkName];
    };
  },

  followLink() {
    return (linkName, opt = {}) => {
      if ( !opt.url ) {
        opt.url = (this.links || {})[linkName];
      }

      if ( opt.urlSuffix ) {
        opt.url += opt.urlSuffix;
      }

      if ( !opt.url ) {
        throw new Error(`Unknown link ${ linkName } on ${ this.type } ${ this.id }`);
      }

      return this.$dispatch('request', opt);
    };
  },

  // ------------------------------------------------------------------

  hasAction() {
    return (actionName) => {
      return !!this.actionLinkFor(actionName);
    };
  },

  actionLinkFor() {
    return (actionName) => {
      return (this.actions || {})[actionName];
    };
  },

  doAction() {
    return (actionName, body, opt = {}) => {
      if ( !opt.url ) {
        opt.url = this.actionLinkFor(actionName);
      }

      opt.method = 'post';
      opt.data = body;

      return this.$dispatch('request', opt);
    };
  },

  // ------------------------------------------------------------------

  patch() {
    return (data, opt = {}) => {
      if ( !opt.url ) {
        opt.url = this.linkFor('self');
      }

      opt.method = 'patch';
      opt.headers = opt.headers || {};
      opt.headers['content-type'] = 'application/json-patch+json';
      opt.data = data;

      return this.$dispatch('request', opt);
    };
  },

  save() {
    delete this.__rehydrate;

    return (opt = {}) => {
      if ( !opt.url ) {
        opt.url = this.linkFor('self');
      }

      if ( !opt.method ) {
        opt.method = (this.id ? 'put' : 'post');
      }

      opt.data = this;

      return this.$dispatch('request', opt);
    };
  },

  remove() {
    return (opt = {}) => {
      if ( !opt.url ) {
        opt.url = (this.links || {})['self'];
      }

      opt.method = 'delete';

      return this.$dispatch('request', opt);
    };
  },

  // ------------------------------------------------------------------

  goToEdit() {
    return (moreQuery = {}) => {
      const currentRoute = window.$nuxt.$route.name;
      const router = window.$nuxt.$router;
      const schema = this.$getters['schemaFor'](this.type);
      let route, params;

      if ( currentRoute.startsWith('rio-') ) {
        const friendly = TO_FRIENDLY[this.type.replace(/^rio-/i, '')];

        if ( friendly ) {
          route = `rio-resource${ schema.attributes.namespaced ? '-namespace' : '' }-id`;
          params = {
            resource:  friendly.resource,
            namespace: this.metadata && this.metadata.namespace,
            id:        this.metadata.name
          };
        }
      }

      if ( !route ) {
        route = `explorer-group-resource${ schema.attributes.namespaced ? '-namespace' : '' }-id`;
        params = {
          group:     schema.groupName,
          resource:  this.type,
          namespace: this.metadata && this.metadata.namespace,
          id:        this.metadata.name
        };
      }

      const url = router.resolve({
        name:   route,
        params,
        query:  { [MODE]: _EDIT, ...moreQuery }
      }).href;

      router.push({ path: url });
    };
  },

  viewEditYaml() {
    return () => {
      return this.goToEdit({ [EDIT_YAML]: _FLAGGED });
    };
  },

  download() {
    return async() => {
      const value = await this.followLink('view', { headers: { accept: 'application/yaml' } }).data;

      downloadFile(`${ this.nameDisplay }.yaml`, value, 'application/yaml');
    };
  },

  downloadBulk() {
    return async(items) => {
      const files = {};
      const names = [];

      for ( const item of items ) {
        let name = `${ item.nameDisplay }.yaml`;
        const i = 2;

        while ( names.includes(name) ) {
          name = `${ item.nameDisplay }_${ i }.yaml`;
        }

        names.push(name);
      }

      await eachLimit(items, 10, (item, idx) => {
        return item.followLink('view', { headers: { accept: 'application/yaml' } } ).then((data) => {
          files[`resources/${ names[idx] }`] = data;
        });
      });

      const zip = generateZip(files);

      downloadFile('resources.zip', zip, 'application/zip');
    };
  },

  viewInApi() {
    return () => {
      window.open(this.links.self, '_blank');
    };
  },

  promptRemove() {
    return () => {
      // @TODO actually prompt...
      this.remove();
    };
  },
};
