//During the test the env variable is set to test
import {MediasoupGetUrls} from "../events";
import * as chai from "chai";
import * as server from "../index";
import chaiHttp = require("chai-http");

process.env.NODE_ENV = 'test';

let should = chai.should();

chai.use(chaiHttp);

function Sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

describe('mediasoup', async () => {
    // Wait for server to initialize
    await Sleep(1000);

    describe('/GET rtp capabilities', () => {
        it('it should GET valid rtp capabilities', (done) => {
            chai.request(server)
                .get(MediasoupGetUrls.GetRTPCapabilities)
                .end((err, res) => {
                    console.log("Have result");
                    res.should.have.status(200);
                    res.body.should.be.a('object');
                    res.body.length.should.be.eql(0);
                    done();
                });
        });
    });
});
