<script>

export default {
  props: {
    value: {
      type:     String,
      default: ''
    },
    row: {
      type:     Object,
      required: true
    },
    col: {
      type:     Object,
      default: () => {}
    },
  },

  data() {
    this.getResource();

    return { resource: null };
  },

  computed: {
    nodeName() {
      return this.resource?.status?.nodeName;
    }
  },

  methods: {
    async getResource() {
      const VMI = 'kubevirt.io.virtualmachineinstance';
      const choices = await this.$store.dispatch('cluster/findAll', { type: VMI });
      const resource = choices.find(VMI => VMI.id === this.value) || null;

      this.resource = resource;
    },
  }
};
</script>

<template>
  <span>
    {{ nodeName }}
  </span>
</template>
