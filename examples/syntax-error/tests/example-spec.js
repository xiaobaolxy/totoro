define(function(require) {

    var expect = require('expect')

    describe('Test Suit', function() {

        it('Test Unit', function() {
            expect('assertion').to.be.a('string')
        })

        // NOTE there is an error!
        var val = undef.attr

    })
})
