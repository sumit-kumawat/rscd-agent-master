/** Normalize Mongoose doc or plain object for remote services. */
function toVmPlain(vm) {
  if (!vm) return vm;
  if (typeof vm.toObject === 'function') return vm.toObject();
  return { ...vm };
}

module.exports = { toVmPlain };
